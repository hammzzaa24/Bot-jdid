const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

// تهيئة البوت
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// التخزين المؤقت للبيانات
const cache = new Map();

// جلب بيانات السوق من CryptoCompare
async function getMarketData(pair) {
  const url = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${pair}&tsym=USDT&limit=10&api_key=${process.env.CRYPTOCOMPARE_API_KEY}`;

  try {
    const response = await axios.get(url);
    return response.data.Data.Data;
  } catch (error) {
    console.error("Error fetching market data:", error);
    return null;
  }
}

// حساب حجم السيولة ونسبة تغير السعر
function calculateMetrics(data) {
  let totalVolume = 0;
  data.forEach((candle) => {
    totalVolume += candle.volumeto; // حجم التداول بالـ USDT
  });

  const firstPrice = data[0].close; // سعر الإغلاق الأول
  const lastPrice = data[data.length - 1].close; // سعر الإغلاق الأخير
  const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100; // نسبة التغير في السعر

  return {
    liquidity: totalVolume,
    priceChange: priceChange,
    lastPrice: lastPrice,
  };
}

// تقديم توصية بناءً على السيولة ونسبة التغير
function generateRecommendation(liquidity, priceChange, lastPrice) {
  if (liquidity > 50000 && priceChange > 2.5) { // شروط أكثر دقة
    const targetPrice = (lastPrice * 1.05).toFixed(2); // هدف 5%
    const stopLoss = (lastPrice * 0.95).toFixed(2); // وقف خسارة 5%
    return {
      recommendation: "شراء (Buy)",
      liquidity: `${liquidity.toLocaleString()} USDT`,
      priceChange: `${priceChange.toFixed(2)}%`,
      lastPrice: `${lastPrice.toFixed(2)} USDT`,
      target: targetPrice,
      stopLoss: stopLoss,
    };
  } else {
    return null;
  }
}

// قراءة الأزواج من الملف
function readPairsFromFile() {
  try {
    const data = fs.readFileSync("pairs.txt", "utf8");
    return data.split("\n").filter((pair) => pair.trim() !== "");
  } catch (error) {
    console.error("Error reading pairs file:", error);
    return [];
  }
}

// إرسال رسالة بدء التحليل
function sendStartMessage(chatId) {
  const message = `
🚀 *بدء التحليل الآلي للأزواج*
-------------------------
📅 التاريخ: ${new Date().toLocaleString()}
📊 عدد الأزواج المفحوصة: ${readPairsFromFile().length}
-------------------------
سيتم إرسال التوصيات فور توفرها.
`;
  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}

// فحص الأزواج بشكل متزامن
async function analyzePairs() {
  const pairs = readPairsFromFile();
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // إرسال رسالة بدء التحليل
  sendStartMessage(chatId);

  // استخدام Promise.all للفحص المتزامن
  const analysisPromises = pairs.map(async (pair) => {
    try {
      let marketData = cache.get(pair);
      if (!marketData) {
        marketData = await getMarketData(pair);
        cache.set(pair, marketData); // تخزين البيانات مؤقتًا
      }

      if (!marketData) return; // تخطي الزوج إذا فشل جلب البيانات

      const { liquidity, priceChange, lastPrice } = calculateMetrics(marketData);
      const recommendation = generateRecommendation(liquidity, priceChange, lastPrice);

      if (recommendation) {
        const message = `
📊 *تحليل الزوج: ${pair}/USDT*
-------------------------
💧 *حجم السيولة (آخر 10 دقائق):* ${recommendation.liquidity}
📈 *نسبة تغير السعر:* ${recommendation.priceChange}
💵 *السعر الحالي:* ${recommendation.lastPrice}
🎯 *الهدف:* ${recommendation.target} USDT
🛑 *وقف الخسارة:* ${recommendation.stopLoss} USDT
-------------------------
💡 *التوصية:* ${recommendation.recommendation}
`;
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
      }
    } catch (error) {
      console.error(`Error analyzing pair ${pair}:`, error);
      bot.sendMessage(chatId, `حدث خطأ أثناء تحليل الزوج ${pair}: ${error.message}`);
    }
  });

  await Promise.all(analysisPromises); // الانتظار حتى انتهاء جميع الفحوصات
}

// دورة لا نهائية لفحص الأزواج بشكل دوري
async function startAnalysisLoop() {
  while (true) {
    await analyzePairs(); // تحليل الأزواج
    await new Promise((resolve) => setTimeout(resolve, 10000)); // تأخير 10 ثواني بين الدورات
  }
}

// بدء الفحص عند تشغيل البوت
startAnalysisLoop();