#!/usr/bin/env python3
import requests
import json
import os
from datetime import datetime
import sys
import time

# Конфигурация
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

# Глобальный кэш для предотвращения частых запросов
_REQUEST_CACHE = {}
_CACHE_TIMEOUT = 300  # 5 минут

def load_portfolio():
    """Загрузка портфеля из файла с обработкой ошибок"""
    try:
        with open('portfolio.json', 'r', encoding='utf-8') as f:
            portfolio_data = json.load(f)
            
        # Валидация структуры портфеля
        if not isinstance(portfolio_data, dict):
            raise ValueError("Portfolio must be a dictionary")
            
        # Фильтрация некорректных значений
        validated_portfolio = {}
        for symbol, lots in portfolio_data.items():
            if isinstance(symbol, str) and isinstance(lots, (int, float)) and lots > 0:
                validated_portfolio[symbol] = int(lots)
                
        return validated_portfolio if validated_portfolio else {"SBER": 10, "GAZP": 5, "VTBR": 1000, "SPBE": 2}
        
    except (FileNotFoundError, json.JSONDecodeError, ValueError) as e:
        print(f"Warning: Error loading portfolio: {e}. Using default portfolio.")
        return {"SBER": 10, "GAZP": 5, "VTBR": 1000, "SPBE": 2}
    except Exception as e:
        print(f"Critical error loading portfolio: {e}")
        return {"SBER": 10, "GAZP": 5, "VTBR": 1000, "SPBE": 2}

def get_moex_data(symbol):
    """Получение данных с МосБиржи с кэшированием и retry логикой"""
    cache_key = f"moex_{symbol}"
    current_time = time.time()
    
    # Проверка кэша
    if cache_key in _REQUEST_CACHE:
        cached_data, timestamp = _REQUEST_CACHE[cache_key]
        if current_time - timestamp < _CACHE_TIMEOUT:
            return cached_data
    
    try:
        url = f"https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/{symbol}.json"
        params = {
            'iss.meta': 'off',
            'securities.columns': 'SECID,PREVADMITTEDQUOTE,LOTSIZE',
            'marketdata.columns': 'LAST,OPEN,LOW,HIGH,VALUE'
        }
        
        # Retry логика
        for attempt in range(3):
            try:
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                data = response.json()
                break
            except requests.exceptions.Timeout:
                if attempt == 2:
                    raise
                time.sleep(1)
            except requests.exceptions.RequestException as e:
                if attempt == 2:
                    raise
                time.sleep(1)
        
        securities = data.get('securities', {}).get('data', [])
        marketdata = data.get('marketdata', {}).get('data', [])
        
        if not securities:
            return None
            
        price = marketdata[0][0] if marketdata and marketdata[0][0] is not None else securities[0][1]
        lot_size = securities[0][2] if len(securities[0]) > 2 and securities[0][2] else 1
        
        if not isinstance(price, (int, float)) or price <= 0:
            return None
            
        result = {
            'price': float(price),
            'lot_size': int(lot_size),
            'source': 'MOEX',
            'timestamp': datetime.now().isoformat()
        }
        
        # Сохранение в кэш
        _REQUEST_CACHE[cache_key] = (result, current_time)
        return result
        
    except Exception as e:
        print(f"Error fetching {symbol}: {e}")
        return None

def generate_report():
    """Генерация торгового отчета с обработкой ошибок"""
    portfolio = load_portfolio()
    market_data = {}
    
    print(f"Processing portfolio with {len(portfolio)} symbols: {list(portfolio.keys())}")
    
    # Сбор данных по активам с ограничением параллелизма
    for symbol in portfolio.keys():
        data = get_moex_data(symbol)
        if data:
            market_data[symbol] = data
        time.sleep(0.1)  # Rate limiting
    
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
    
    report = "🤖 АВТООТЧЕТ ДЛЯ AI-АНАЛИТИКА\n"
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
    
    # Добавляем информацию о проблемных активах
    failed_symbols = [s for s in portfolio.keys() if s not in positions]
    if failed_symbols:
        report += "⚠️ ПРОБЛЕМНЫЕ АКТИВЫ (данные недоступны):\n"
        for symbol in failed_symbols:
            report += f"{symbol}: {portfolio[symbol]} лотов\n"
        report += "\n"
    
    report += "🎯 Отправьте этот отчет AI-аналитику для рекомендаций\n"
    report += "=" * 50
    
    return report

def send_telegram_message(message):
    """Отправка сообщения в Telegram с обработкой ошибок"""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("Telegram credentials not set")
        return False
    
    # Обрезка длинных сообщений для Telegram
    if len(message) > 4000:
        message = message[:4000] + "\n... [сообщение обрезано]"
    
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        'chat_id': TELEGRAM_CHAT_ID,
        'text': message,
        'parse_mode': 'HTML'
    }
    
    try:
        response = requests.post(url, json=payload, timeout=15)
        if response.status_code != 200:
            print(f"Telegram API error: {response.status_code} - {response.text}")
            return False
        return True
    except Exception as e:
        print(f"Error sending Telegram message: {e}")
        return False

def main():
    """Основная функция с улучшенной обработкой ошибок"""
    print("🤖 Генерация автоматического отчета...")
    
    try:
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
            
    except Exception as e:
        print(f"❌ Критическая ошибка в main: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()