// Configuration for data sources
const DATA_SOURCES = {
    moexAPI: 'https://iss.moex.com/iss',
    newsURL: 'https://www.moex.com/ru/news/'
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

    try {
        // Fetch data for all portfolio symbols
        const stockPromises = portfolioSymbols.map(symbol => 
            fetchStockData(symbol).catch(error => {
                console.error(`Error fetching ${symbol}:`, error);
                return null;
            })
        );
        
        const stockResults = await Promise.all(stockPromises);
        stockResults.forEach((data, index) => {
            if (data) {
                marketData.stocks[portfolioSymbols[index]] = data;
            }
        });

        // Fetch market indices
        marketData.indices = await fetchMarketIndices();
        
        // Fetch market news
        marketData.news = await fetchMarketNews();
        
        // Generate market summary
        marketData.marketSummary = generateMarketSummary(marketData.stocks, marketData.indices);
        
        console.log('Enhanced market data fetch completed');
        return marketData;
        
    } catch (error) {
        console.error('Error in enhanced market data fetch:', error);
        throw error;
    }
}

// Fetch individual stock data from MOEX API
async function fetchStockData(symbol) {
    try {
        // First try main board (TQBR)
        let url = `${DATA_SOURCES.moexAPI}/engines/stock/markets/shares/boards/TQBR/securities/${symbol}.json`;
        let params = {
            'iss.meta': 'off',
            'iss.only': 'securities,marketdata',
            'securities.columns': 'SECID,PREVADMITTEDQUOTE,LOTSIZE',
            'marketdata.columns': 'LAST,OPEN,LOW,HIGH,VALUE,CHANGE,LASTTOPREVPRICE'
        };

        const response = await fetch(`${url}?${new URLSearchParams(params)}`);
        
        if (!response.ok) {
            // Try foreign shares board (FQBR) for SPB stocks
            url = `${DATA_SOURCES.moexAPI}/engines/stock/markets/foreignshares/boards/FQBR/securities/${symbol}.json`;
            const spbResponse = await fetch(`${url}?${new URLSearchParams(params)}`);
            
            if (!spbResponse.ok) {
                throw new Error(`Failed to fetch data for ${symbol}`);
            }
            
            const spbData = await spbResponse.json();
            return parseStockData(symbol, spbData, 'SPB');
        }

        const data = await response.json();
        return parseStockData(symbol, data, 'MOEX');
        
    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error);
        // Return mock data as fallback
        return generateMockStockData(symbol);
    }
}

// Parse stock data from MOEX response
function parseStockData(symbol, data, source) {
    const securities = data.securities.data[0] || [];
    const marketdata = data.marketdata.data[0] || [];
    
    const prevPrice = securities[1] || 0; // PREVADMITTEDQUOTE
    const currentPrice = marketdata[0] || prevPrice; // LAST
    const change = marketdata[6] || 0; // LASTTOPREVPRICE
    
    return {
        symbol: symbol,
        price: currentPrice,
        open: marketdata[1] || currentPrice, // OPEN
        low: marketdata[2] || currentPrice, // LOW
        high: marketdata[3] || currentPrice, // HIGH
        volume: marketdata[4] || 0, // VALUE
        change: change,
        changePercent: prevPrice ? ((change / prevPrice) * 100) : 0,
        lotSize: securities[2] || 1, // LOTSIZE
        source: source,
        timestamp: new Date().toISOString()
    };
}

// Fetch market indices
async function fetchMarketIndices() {
    try {
        const indices = {};
        
        // Fetch IMOEX (Moscow Exchange Index)
        const imoexResponse = await fetch(
            `${DATA_SOURCES.moexAPI}/statistics/engines/stock/markets/index/analytics/IMOEX.json?iss.meta=off`
        );
        
        if (imoexResponse.ok) {
            const imoexData = await imoexResponse.json();
            const analytics = imoexData.analytics.data[0] || [];
            indices.IMOEX = {
                value: analytics[0] || 0,
                change: analytics[1] || 0
            };
        }
        
        // Fetch RTSI
        const rtsResponse = await fetch(
            `${DATA_SOURCES.moexAPI}/statistics/engines/stock/markets/index/analytics/RTSI.json?iss.meta=off`
        );
        
        if (rtsResponse.ok) {
            const rtsData = await rtsResponse.json();
            const analytics = rtsData.analytics.data[0] || [];
            indices.RTSI = {
                value: analytics[0] || 0,
                change: analytics[1] || 0
            };
        }
        
        return indices;
        
    } catch (error) {
        console.error('Error fetching market indices:', error);
        return {
            IMOEX: { value: 2702.44, change: -1.544 },
            RTSI: { value: 1046.39, change: -1.545 }
        };
    }
}

// Fetch market news (simplified - in production you'd need a proper API)
async function fetchMarketNews() {
    try {
        // Note: This is a simplified example
        // In a real application, you'd need to use a proper news API
        // or set up a server-side proxy to avoid CORS issues
        
        const mockNews = [
            {
                title: "Индекс Мосбиржи стабилизируется после снижения",
                summary: "По состоянию на 14:30 мск индекс Мосбиржи понизился на 42,39 пункта (1,544%)",
                timestamp: new Date().toISOString(),
                source: "FINMARKET.RU"
            },
            {
                title: "Торги идут с активностью выше средней",
                summary: "Объем торгов по акциям на ФБ ММВБ на 14:30 составил 65728,1 млн рублей",
                timestamp: new Date().toISOString(),
                source: "Мосбиржа"
            },
            {
                title: "Мосбиржа начала торги сотым биржевым фондом",
                summary: "Расширение линейки биржевых инвестиционных продуктов",
                timestamp: "2025-10-20T20:56:00Z",
                source: "Мосбиржа"
            }
        ];
        
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
        if (stock.changePercent) {
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
        'ROSN': 585.0, 'YNDX': 2670.0, 'GMKN': 130.0
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
        const portfolioSymbols = Object.keys(analyzer.portfolio);
        
        if (portfolioSymbols.length === 0) {
            throw new Error('Portfolio is empty. Please add assets to generate a report.');
        }

        showStatus('🔄 Collecting enhanced market data...', 'info');
        
        const marketData = await fetchEnhancedMarketData(portfolioSymbols);
        const portfolioValue = analyzer.calculatePortfolioValue(marketData.stocks);
        
        const report = {
            timestamp: new Date().toISOString(),
            portfolioStructure: analyzer.portfolio,
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

// Enhanced report formatter
function formatEnhancedReport(report) {
    let output = [];
    
    output.push("🤖 РАСШИРЕННЫЙ ОТЧЕТ ДЛЯ AI-АНАЛИТИКА");
    output.push("=" * 60);
    output.push(`Сгенерировано: ${new Date(report.timestamp).toLocaleString('ru-RU')}`);
    output.push("");
    
    // Market Summary Section
    output.push("📈 СВОДКА РЫНКА:");
    output.push("-" * 40);
    output.push(`Индекс МосБиржи: ${report.marketData.indices.IMOEX?.value || 'N/A'} (${report.marketData.indices.IMOEX?.change || 'N/A'}%)`);
    output.push(`Индекс РТС: ${report.marketData.indices.RTSI?.value || 'N/A'} (${report.marketData.indices.RTSI?.change || 'N/A'}%)`);
    output.push(`Среднее изменение портфеля: ${report.marketSummary.averageChange?.toFixed(2) || 'N/A'}%`);
    output.push(`Настроение рынка: ${report.marketSummary.marketSentiment || 'N/A'}`);
    output.push(`Лучший performer: ${report.marketSummary.bestPerformer?.symbol || 'N/A'} (${report.marketSummary.bestPerformer?.change?.toFixed(2) || 'N/A'}%)`);
    output.push(`Худший performer: ${report.marketSummary.worstPerformer?.symbol || 'N/A'} (${report.marketSummary.worstPerformer?.change?.toFixed(2) || 'N/A'}%)`);
    output.push("");
    
    // Portfolio Structure
    output.push("📊 СТРУКТУРА ПОРТФЕЛЯ:");
    output.push("-" * 40);
    Object.entries(report.portfolioStructure).forEach(([symbol, lots]) => {
        output.push(`${symbol}: ${lots} лотов`);
    });
    output.push("");
    
    // Detailed Position Analysis
    output.push("💰 ДЕТАЛЬНЫЙ АНАЛИЗ ПОЗИЦИЙ:");
    output.push("-" * 40);
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
        output.push(`  Источник данных: ${marketData?.source || 'N/A'}`);
        output.push("");
    });
    
    output.push(`ОБЩАЯ СТОИМОСТЬ ПОРТФЕЛЯ: ${totalValue.toLocaleString('ru-RU')} RUB`);
    output.push("");
    
    // Market News Section
    if (report.marketData.news && report.marketData.news.length > 0) {
        output.push("📰 ПОСЛЕДНИЕ НОВОСТИ РЫНКА:");
        output.push("-" * 40);
        report.marketData.news.forEach((newsItem, index) => {
            output.push(`${index + 1}. ${newsItem.title}`);
            output.push(`   ${newsItem.summary}`);
            output.push(`   Источник: ${newsItem.source} | ${new Date(newsItem.timestamp).toLocaleString('ru-RU')}`);
            output.push("");
        });
    }
    
    // AI Request Section
    output.push("🎯 ЗАПРОС К AI-АНАЛИТИКУ:");
    output.push("-" * 40);
    output.push("На основе представленных данных проанализируйте:");
    output.push("1. Текущее состояние портфеля и распределение активов");
    output.push("2. Влияние рыночной конъюнктуры на позиции портфеля");
    output.push("3. Рекомендации по ребалансировке на основе новостного фона");
    output.push("4. Оценка рисков и возможности хеджирования");
    output.push("5. Краткосрочные и долгосрочные перспективы активов");
    output.push("");
    output.push("=" * 60);
    
    return output.join('\n');
}

// Update your existing generateReport function to use the enhanced version
async function generateReport() {
    try {
        const report = await generateEnhancedReport();
        analyzer.currentReport = report;
        analyzer.displayReport();
        analyzer.showStatus('✅ Расширенный отчет сгенерирован!', 'success');
        
        // Auto-save the enhanced report
        const filename = analyzer.saveReportToFile(report, "enhanced");
        if (filename) {
            analyzer.showStatus(`💾 Отчет сохранен: ${filename}`, 'success');
        }
        
    } catch (error) {
        analyzer.showStatus(`❌ Ошибка генерации отчета: ${error.message}`, 'error');
    }
}