// Единый менеджер состояния приложения
class AppState {
    constructor() {
        this.portfolio = {};
        this.currentReport = null;
        this.marketData = {};
        this.isLoading = false;
        this.init();
    }

    async init() {
        await this.loadPortfolio();
        this.updatePortfolioDisplay();
    }

    async loadPortfolio() {
        try {
            const saved = localStorage.getItem('trading-portfolio');
            if (saved) {
                this.portfolio = JSON.parse(saved);
            } else {
                // Загрузка из файла или использование по умолчанию
                const response = await fetch('portfolio.json');
                if (response.ok) {
                    this.portfolio = await response.json();
                } else {
                    this.portfolio = {"SBER": 10, "GAZP": 5, "VTBR": 1000, "SPBE": 2};
                }
            }
            this.validatePortfolio();
        } catch (error) {
            console.error('Error loading portfolio:', error);
            this.portfolio = {"SBER": 10, "GAZP": 5, "VTBR": 1000, "SPBE": 2};
        }
    }

    validatePortfolio() {
        const validated = {};
        for (const [symbol, lots] of Object.entries(this.portfolio)) {
            if (typeof symbol === 'string' && typeof lots === 'number' && lots > 0) {
                validated[symbol] = Math.floor(lots);
            }
        }
        this.portfolio = Object.keys(validated).length > 0 ? validated : {"SBER": 10, "GAZP": 5, "VTBR": 1000, "SPBE": 2};
    }

    savePortfolio() {
        try {
            localStorage.setItem('trading-portfolio', JSON.stringify(this.portfolio));
            return true;
        } catch (error) {
            console.error('Error saving portfolio:', error);
            return false;
        }
    }

    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('reportStatus');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = `status ${type}`;
            
            // Автоочистка успешных сообщений
            if (type === 'success') {
                setTimeout(() => {
                    if (statusEl.textContent === message) {
                        statusEl.textContent = '';
                        statusEl.className = 'status';
                    }
                }, 5000);
            }
        }
    }
}

// Инициализация глобального состояния
const appState = new AppState();

// Configuration for data sources
const DATA_SOURCES = {
    moexAPI: 'https://iss.moex.com/iss',
    newsURL: 'https://www.moex.com/ru/news/'
};

// Кэш для данных
const dataCache = {
    stocks: new Map(),
    indices: new Map(),
    news: new Map(),
    
    set(key, data, category = 'stocks', ttl = 300000) { // 5 минут по умолчанию
        const cacheKey = `${category}_${key}`;
        this[category].set(cacheKey, {
            data,
            timestamp: Date.now(),
            ttl
        });
    },
    
    get(key, category = 'stocks') {
        const cacheKey = `${category}_${key}`;
        const cached = this[category].get(cacheKey);
        if (cached && Date.now() - cached.timestamp < cached.ttl) {
            return cached.data;
        }
        this[category].delete(cacheKey);
        return null;
    }
};

// Enhanced market data fetcher
async function fetchEnhancedMarketData(portfolioSymbols) {
    console.log('Starting enhanced market data fetch...');
    
    const marketData = {
        stocks: {},
        indices: {},
        marketSummary: {},
        news: []
    };

    if (appState.isLoading) {
        throw new Error('Data fetch already in progress');
    }

    appState.isLoading = true;

    try {
        // Fetch data for all portfolio symbols
        const stockPromises = portfolioSymbols.map(symbol => 
            fetchStockData(symbol).catch(error => {
                console.error(`Error fetching ${symbol}:`, error);
                return this.generateMockStockData(symbol);
            })
        );
        
        const stockResults = await Promise.allSettled(stockPromises);
        stockResults.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
                marketData.stocks[portfolioSymbols[index]] = result.value;
            }
        });

        // Fetch market indices
        try {
            marketData.indices = await fetchMarketIndices();
        } catch (error) {
            console.error('Error fetching indices:', error);
            marketData.indices = await this.getFallbackIndices();
        }
        
        // Fetch market news
        try {
            marketData.news = await fetchMarketNews();
        } catch (error) {
            console.error('Error fetching news:', error);
            marketData.news = [];
        }
        
        // Generate market summary
        marketData.marketSummary = generateMarketSummary(marketData.stocks, marketData.indices);
        
        // Сохраняем в глобальное состояние
        appState.marketData = marketData;
        
        console.log('Enhanced market data fetch completed');
        return marketData;
        
    } catch (error) {
        console.error('Error in enhanced market data fetch:', error);
        throw error;
    } finally {
        appState.isLoading = false;
    }
}

// Fetch individual stock data from MOEX API
async function fetchStockData(symbol) {
    // Проверка кэша
    const cached = dataCache.get(symbol, 'stocks');
    if (cached) return cached;

    try {
        // First try main board (TQBR)
        let url = `${DATA_SOURCES.moexAPI}/engines/stock/markets/shares/boards/TQBR/securities/${symbol}.json`;
        let params = {
            'iss.meta': 'off',
            'iss.only': 'securities,marketdata',
            'securities.columns': 'SECID,PREVADMITTEDQUOTE,LOTSIZE',
            'marketdata.columns': 'LAST,OPEN,LOW,HIGH,VALUE,CHANGE,LASTTOPREVPRICE'
        };

        const response = await fetch(`${url}?${new URLSearchParams(params)}`, {
            signal: AbortSignal.timeout(10000)
        });
        
        if (!response.ok) {
            // Try foreign shares board (FQBR) for SPB stocks
            url = `${DATA_SOURCES.moexAPI}/engines/stock/markets/foreignshares/boards/FQBR/securities/${symbol}.json`;
            const spbResponse = await fetch(`${url}?${new URLSearchParams(params)}`, {
                signal: AbortSignal.timeout(10000)
            });
            
            if (!spbResponse.ok) {
                throw new Error(`Failed to fetch data for ${symbol}: ${response.status}`);
            }
            
            const spbData = await spbResponse.json();
            const result = parseStockData(symbol, spbData, 'SPB');
            dataCache.set(symbol, result, 'stocks');
            return result;
        }

        const data = await response.json();
        const result = parseStockData(symbol, data, 'MOEX');
        dataCache.set(symbol, result, 'stocks');
        return result;
        
    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error);
        // Return mock data as fallback
        const mockData = generateMockStockData(symbol);
        dataCache.set(symbol, mockData, 'stocks', 60000); // Кэшируем mock данные на 1 минуту
        return mockData;
    }
}

// Parse stock data from MOEX response
function parseStockData(symbol, data, source) {
    const securities = data.securities.data[0] || [];
    const marketdata = data.marketdata.data[0] || [];
    
    const prevPrice = securities[1] || 0;
    const currentPrice = marketdata[0] || prevPrice;
    const change = marketdata[6] || 0;
    
    // Валидация данных
    if (!currentPrice || currentPrice <= 0) {
        throw new Error(`Invalid price data for ${symbol}`);
    }

    return {
        symbol: symbol,
        price: currentPrice,
        open: marketdata[1] || currentPrice,
        low: marketdata[2] || currentPrice,
        high: marketdata[3] || currentPrice,
        volume: marketdata[4] || 0,
        change: change,
        changePercent: prevPrice ? ((change / prevPrice) * 100) : 0,
        lotSize: securities[2] || 1,
        source: source,
        timestamp: new Date().toISOString(),
        isRealData: true
    };
}

// Fetch market indices
async function fetchMarketIndices() {
    const cached = dataCache.get('indices', 'indices');
    if (cached) return cached;

    try {
        const indices = {};
        
        const [imoexResponse, rtsResponse] = await Promise.all([
            fetch(`${DATA_SOURCES.moexAPI}/statistics/engines/stock/markets/index/analytics/IMOEX.json?iss.meta=off`),
            fetch(`${DATA_SOURCES.moexAPI}/statistics/engines/stock/markets/index/analytics/RTSI.json?iss.meta=off`)
        ]);
        
        if (imoexResponse.ok) {
            const imoexData = await imoexResponse.json();
            const analytics = imoexData.analytics.data[0] || [];
            indices.IMOEX = {
                value: analytics[0] || 0,
                change: analytics[1] || 0
            };
        }
        
        if (rtsResponse.ok) {
            const rtsData = await rtsResponse.json();
            const analytics = rtsData.analytics.data[0] || [];
            indices.RTSI = {
                value: analytics[0] || 0,
                change: analytics[1] || 0
            };
        }
        
        dataCache.set('indices', indices, 'indices');
        return indices;
        
    } catch (error) {
        console.error('Error fetching market indices:', error);
        return await this.getFallbackIndices();
    }
}

// Fallback indices data
async function getFallbackIndices() {
    return {
        IMOEX: { value: 2702.44, change: -1.544 },
        RTSI: { value: 1046.39, change: -1.545 }
    };
}

// Fetch market news (simplified)
async function fetchMarketNews() {
    const cached = dataCache.get('news', 'news');
    if (cached) return cached;

    try {
        // В реальном приложении здесь должен быть вызов к News API
        const mockNews = [
            {
                title: "Индекс Мосбиржи стабилизируется после снижения",
                summary: "По состоянию на 14:30 мск индекс Мосбиржи понизился на 42,39 пункта (1,544%)",
                timestamp: new Date().toISOString(),
                source: "FINMARKET.RU"
            }
        ];
        
        dataCache.set('news', mockNews, 'news', 600000); // 10 минут
        return mockNews;
        
    } catch (error) {
        console.error('Error fetching news:', error);
        return [];
    }
}

// Generate market summary
function generateMarketSummary(stocksData, indices) {
    let totalChange = 0;
    let stockCount = 0;
    let bestPerformer = { symbol: '', change: -Infinity };
    let worstPerformer = { symbol: '', change: Infinity };

    Object.values(stocksData).forEach(stock => {
        if (stock.changePercent !== undefined) {
            totalChange += stock.changePercent;
            stockCount++;
            
            if (stock.changePercent > bestPerformer.change) {
                bestPerformer = { symbol: stock.symbol, change: stock.changePercent };
            }
            if (stock.changePercent < worstPerformer.change) {
                worstPerformer = { symbol: stock.symbol, change: stock.changePercent };
            }
        }
    });

    const averageChange = stockCount > 0 ? totalChange / stockCount : 0;
    const marketSentiment = averageChange > 0.5 ? 'BULLISH' : averageChange < -0.5 ? 'BEARISH' : 'NEUTRAL';

    return {
        averageChange,
        marketSentiment,
        bestPerformer,
        worstPerformer,
        totalStocks: Object.keys(stocksData).length,
        updatedAt: new Date().toISOString()
    };
}

// Fallback mock data generator
function generateMockStockData(symbol) {
    const basePrices = {
        'SBER': 280.5, 'GAZP': 160.8, 'VTBR': 0.0265, 
        'SPBE': 255.7, 'MOEX': 170.7, 'LKOH': 6305.5,
        'ROSN': 585.0, 'YNDX': 2670.0, 'GMKN': 130.0,
        'MTSS': 250.0
    };
    
    const basePrice = basePrices[symbol] || 100;
    const change = (Math.random() - 0.5) * 10;
    const changePercent = (change / basePrice) * 100;
    
    return {
        symbol: symbol,
        price: basePrice + change,
        open: basePrice,
        low: basePrice - Math.random() * 5,
        high: basePrice + Math.random() * 5,
        volume: Math.random() * 1000000,
        change: change,
        changePercent: changePercent,
        lotSize: 10,
        source: 'MOCK',
        timestamp: new Date().toISOString(),
        isMockData: true
    };
}

// Enhanced report generator
async function generateEnhancedReport() {
    try {
        const portfolioSymbols = Object.keys(appState.portfolio);
        
        if (portfolioSymbols.length === 0) {
            throw new Error('Portfolio is empty. Please add assets to generate a report.');
        }

        appState.showStatus('🔄 Collecting enhanced market data...', 'info');
        
        const marketData = await fetchEnhancedMarketData(portfolioSymbols);
        const portfolioValue = calculatePortfolioValue(marketData.stocks);
        
        const report = {
            timestamp: new Date().toISOString(),
            portfolioStructure: appState.portfolio,
            portfolioValue: portfolioValue,
            marketData: marketData,
            marketSummary: marketData.marketSummary
        };

        return formatEnhancedReport(report);
        
    } catch (error) {
        console.error('Error generating enhanced report:', error);
        throw error;
    }
}

// Calculate portfolio value
function calculatePortfolioValue(stocksData) {
    let totalValue = 0;
    const positions = {};

    for (const [symbol, lots] of Object.entries(appState.portfolio)) {
        const stock = stocksData[symbol];
        if (stock && stock.price) {
            const lotSize = stock.lotSize || 1;
            const positionValue = stock.price * lots * lotSize;
            
            positions[symbol] = {
                lots: lots,
                lot_size: lotSize,
                position_value: positionValue
            };
            totalValue += positionValue;
        }
    }

    return {
        totalValue: totalValue,
        positions: positions
    };
}

// Enhanced report formatter
function formatEnhancedReport(report) {
    let output = [];
    
    output.push("🤖 РАСШИРЕННЫЙ ОТЧЕТ ДЛЯ AI-АНАЛИТИКА");
    output.push("=".repeat(60));
    output.push(`Сгенерировано: ${new Date(report.timestamp).toLocaleString('ru-RU')}`);
    output.push("");
    
    // Market Summary Section
    output.push("📈 СВОДКА РЫНКА:");
    output.push("-".repeat(40));
    output.push(`Индекс МосБиржи: ${report.marketData.indices.IMOEX?.value || 'N/A'} (${report.marketData.indices.IMOEX?.change || 'N/A'}%)`);
    output.push(`Индекс РТС: ${report.marketData.indices.RTSI?.value || 'N/A'} (${report.marketData.indices.RTSI?.change || 'N/A'}%)`);
    output.push(`Среднее изменение портфеля: ${report.marketSummary.averageChange?.toFixed(2) || 'N/A'}%`);
    output.push(`Настроение рынка: ${report.marketSummary.marketSentiment || 'N/A'}`);
    output.push(`Лучший performer: ${report.marketSummary.bestPerformer?.symbol || 'N/A'} (${report.marketSummary.bestPerformer?.change?.toFixed(2) || 'N/A'}%)`);
    output.push(`Худший performer: ${report.marketSummary.worstPerformer?.symbol || 'N/A'} (${report.marketSummary.worstPerformer?.change?.toFixed(2) || 'N/A'}%)`);
    output.push("");
    
    // Portfolio Structure
    output.push("📊 СТРУКТУРА ПОРТФЕЛЯ:");
    output.push("-".repeat(40));
    Object.entries(report.portfolioStructure).forEach(([symbol, lots]) => {
        output.push(`${symbol}: ${lots} лотов`);
    });
    output.push("");
    
    // Detailed Position Analysis
    output.push("💰 ДЕТАЛЬНЫЙ АНАЛИЗ ПОЗИЦИЙ:");
    output.push("-".repeat(40));
    const totalValue = report.portfolioValue.totalValue;
    
    Object.entries(report.portfolioValue.positions).forEach(([symbol, position]) => {
        const marketData = report.marketData.stocks[symbol];
        const value = position.position_value;
        const percent = totalValue > 0 ? (value / totalValue * 100) : 0;
        
        output.push(`${symbol}:`);
        output.push(`  Лотов: ${position.lots} × ${position.lot_size} шт.`);
        output.push(`  Текущая цена: ${marketData?.price?.toFixed(2) || 'N/A'} RUB`);
        output.push(`  Изменение: ${marketData?.changePercent?.toFixed(2) || 'N/A'}%`);
        output.push(`  Стоимость позиции: ${value.toLocaleString('ru-RU')} RUB (${percent.toFixed(1)}%)`);
        output.push(`  Источник данных: ${marketData?.source || 'N/A'} ${marketData?.isMockData ? '(MOCK)' : ''}`);
        output.push("");
    });
    
    output.push(`ОБЩАЯ СТОИМОСТЬ ПОРТФЕЛЯ: ${totalValue.toLocaleString('ru-RU')} RUB`);
    output.push("");
    
    // Market News Section
    if (report.marketData.news && report.marketData.news.length > 0) {
        output.push("📰 ПОСЛЕДНИЕ НОВОСТИ РЫНКА:");
        output.push("-".repeat(40));
        report.marketData.news.forEach((newsItem, index) => {
            output.push(`${index + 1}. ${newsItem.title}`);
            output.push(`   ${newsItem.summary}`);
            output.push(`   Источник: ${newsItem.source} | ${new Date(newsItem.timestamp).toLocaleString('ru-RU')}`);
            output.push("");
        });
    }
    
    // AI Request Section
    output.push("🎯 ЗАПРОС К AI-АНАЛИТИКУ:");
    output.push("-".repeat(40));
    output.push("На основе представленных данных проанализируйте:");
    output.push("1. Текущее состояние портфеля и распределение активов");
    output.push("2. Влияние рыночной конъюнктуры на позиции портфеля");
    output.push("3. Рекомендации по ребалансировке на основе новостного фона");
    output.push("4. Оценка рисков и возможности хеджирования");
    output.push("5. Краткосрочные и долгосрочные перспективы активов");
    output.push("");
    output.push("=".repeat(60));
    
    return output.join('\n');
}

// Update your existing generateReport function to use the enhanced version
async function generateReport() {
    try {
        const report = await generateEnhancedReport();
        appState.currentReport = report;
        displayReport();
        appState.showStatus('✅ Расширенный отчет сгенерирован!', 'success');
        
        // Auto-save the enhanced report
        const filename = saveReportToFile(report, "enhanced");
        if (filename) {
            appState.showStatus(`💾 Отчет сохранен: ${filename}`, 'success');
        }
        
    } catch (error) {
        appState.showStatus(`❌ Ошибка генерации отчета: ${error.message}`, 'error');
    }
}

// Display report in UI
function displayReport() {
    const output = document.getElementById('reportOutput');
    if (output && appState.currentReport) {
        output.textContent = appState.currentReport;
    }
}

// Save report to file
function saveReportToFile(report, prefix = 'report') {
    try {
        const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${prefix}_${new Date().toISOString().slice(0, 10)}_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return a.download;
    } catch (error) {
        console.error('Error saving report:', error);
        return null;
    }
}

// UI Interaction Functions
function savePortfolio() {
    try {
        const input = document.getElementById('portfolioInput');
        if (!input) return;
        
        const lines = input.value.split('\n');
        const newPortfolio = {};
        
        lines.forEach(line => {
            const [symbol, lots]= line.split(':').map(s => s.trim());
            if (symbol && !isNaN(parseFloat(lots)) && isFinite(lots)) {
                newPortfolio[symbol] = parseFloat(lots);
            }
        });
        
        appState.portfolio = newPortfolio;
        appState.validatePortfolio();
        
        if (appState.savePortfolio()) {
            appState.showStatus('✅ Портфель сохранен!', 'success');
            updatePortfolioDisplay();
        } else {
            appState.showStatus('❌ Ошибка сохранения портфеля', 'error');
        }
    } catch (error) {
        appState.showStatus(`❌ Ошибка: ${error.message}`, 'error');
    }
}

function loadPortfolio() {
    try {
        const input = document.getElementById('portfolioInput');
        if (input) {
            const lines = [];
            for (const [symbol, lots] of Object.entries(appState.portfolio)) {
                lines.push(`${symbol}:${lots}`);
            }
            input.value = lines.join('\n');
        }
        appState.showStatus('✅ Портфель загружен в редактор!', 'success');
    } catch (error) {
        appState.showStatus(`❌ Ошибка загрузки портфеля: ${error.message}`, 'error');
    }
}

function updatePortfolioDisplay() {
    const display = document.getElementById('portfolioDisplay');
    if (!display) return;

    if (Object.keys(appState.portfolio).length === 0) {
        display.innerHTML = '<p>Портфель пуст</p>';
        return;
    }

    let html = '';
    for (const [symbol, lots] of Object.entries(appState.portfolio)) {
        html += `<div class="asset-item">${symbol}: ${lots} лотов</div>`;
    }
    display.innerHTML = html;
}

function copyReport() {
    if (!appState.currentReport) {
        appState.showStatus('Нет отчета для копирования', 'error');
        return;
    }
    
    navigator.clipboard.writeText(appState.currentReport).then(() => {
        appState.showStatus('✅ Отчет скопирован в буфер обмена!', 'success');
    }).catch(err => {
        appState.showStatus('❌ Ошибка копирования: ' + err, 'error');
    });
}

function downloadReport() {
    if (!appState.currentReport) {
        appState.showStatus('Нет отчета для скачивания', 'error');
        return;
    }
    
    const filename = saveReportToFile(appState.currentReport, "trading_report");
    if (filename) {
        appState.showStatus(`✅ Отчет сохранен как ${filename}`, 'success');
    } else {
        appState.showStatus('❌ Ошибка сохранения отчета', 'error');
    }
}

function sendToAI() {
    appState.showStatus('🤖 Функция отправки AI-аналитику в разработке', 'info');
}

function scheduleAutoReport() {
    appState.showStatus('⏰ Автоотчеты выполняются через GitHub Actions', 'info');
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    updatePortfolioDisplay();
});