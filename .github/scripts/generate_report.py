#!/usr/bin/env python3
import requests
import json
import os
from datetime import datetime
import sys

# Конфигурация
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

def load_portfolio():
    """Загрузка портфеля из файла"""
    try:
        with open('data/portfolio.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading portfolio: {e}")
        return {"SBER": 10, "GAZP": 5, "VTBR": 1000, "SPBE": 2}

def get_moex_data(symbol):
    """Получение данных с МосБиржи"""
    try:
        url = f"https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/{symbol}.json"
        params = {
            'iss.meta': 'off',
            'securities.columns': 'SECID,PREVADMITTEDQUOTE,LOTSIZE',
            'marketdata.columns': 'LAST,OPEN,LOW,HIGH,VALUE'
        }
        
        response = requests.get(url, params=params, timeout=10)
        data = response.json()
        
        securities = data.get('securities', {}).get('data', [])
        marketdata = data.get('marketdata', {}).get('data', [])
        
        if not securities:
            return None
            
        price = marketdata[0][0] if marketdata and marketdata[0][0] else securities[0][1]
        lot_size = securities[0][2] if len(securities[0]) > 2 else 1
        
        return {
            'price': price,
            'lot_size': lot_size,
            'source': 'MOEX'
        }
    except Exception as e:
        print(f"Error fetching {symbol}: {e}")
        return None

def generate_report():
    """Генерация торгового отчета"""
    portfolio = load_portfolio()
    market_data = {}
    
    # Сбор данных по активам
    for symbol in portfolio.keys():
        data = get_moex_data(symbol)
        if data:
            market_data[symbol] = data
    
    # Расчет стоимости портфеля
    total_value = 0
    positions = {}
    
    for symbol, lots in portfolio.items():
        data = market_data.get(symbol, {})
        if data and data.get('price'):
            price = data['price']
            lot_size = data.get('lot_size', 1)
            position_value = price * lots * lot_size
            
            positions[symbol] = {
                'lots': lots,
                'price': price,
                'lot_size': lot_size,
                'position_value': position_value
            }
            total_value += position_value
    
    # Форматирование отчета
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    report = f"🤖 АВТООТЧЕТ ДЛЯ AI-АНАЛИТИКА\n"
    report += "=" * 50 + "\n"
    report += f"Время: {timestamp}\n\n"
    
    report += "📊 ПОРТФЕЛЬ:\n"
    report += "-" * 30 + "\n"
    for symbol, lots in portfolio.items():
        report += f"{symbol}: {lots} лотов\n"
    
    report += "\n💰 СТОИМОСТЬ:\n"
    report += "-" * 30 + "\n"
    for symbol, position in positions.items():
        value = position['position_value']
        percent = (value / total_value * 100) if total_value > 0 else 0
        report += f"{symbol}: {value:,.0f} RUB ({percent:.1f}%)\n"
    
    report += f"\nВСЕГО: {total_value:,.0f} RUB\n\n"
    report += "🎯 Отправьте этот отчет AI-аналитику для рекомендаций\n"
    report += "=" * 50
    
    return report

def send_telegram_message(message):
    """Отправка сообщения в Telegram"""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("Telegram credentials not set")
        return False
    
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        'chat_id': TELEGRAM_CHAT_ID,
        'text': message,
        'parse_mode': 'HTML'
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        return response.status_code == 200
    except Exception as e:
        print(f"Error sending Telegram message: {e}")
        return False

def main():
    """Основная функция"""
    print("🤖 Генерация автоматического отчета...")
    
    # Создаем папку для отчетов
    os.makedirs('reports', exist_ok=True)
    
    # Генерируем отчет
    report = generate_report()
    
    # Сохраняем в файл
    timestamp = datetime.now().strftime('%Y%m%d_%H%M')
    filename = f'reports/auto_report_{timestamp}.txt'
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(report)
    
    print(f"✅ Отчет сохранен: {filename}")
    
    # Отправляем в Telegram
    if send_telegram_message(f"<pre>{report}</pre>"):
        print("✅ Отчет отправлен в Telegram")
    else:
        print("❌ Ошибка отправки в Telegram")

if __name__ == "__main__":
    main()