import { fetch } from 'cross-fetch'; // Node 18以上なら不要ですが念のため

// ★あなたのプールアドレス (Native USDC / WETH 0.05%)
const POOL_ADDRESS = '0x641c00a822e8b67699066c45c81f67f407772737';
const NETWORK = 'arbitrum';

async function main() {
  console.log(`Fetching history from GeckoTerminal for: ${POOL_ADDRESS}...`);

  // OHLCV (始値・高値・安値・終値・出来高) を取得
  // hour = 1時間足, limit = 24本
  const url = `https://api.geckoterminal.com/api/v2/networks/${NETWORK}/pools/${POOL_ADDRESS}/ohlcv/hour?limit=24`;

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }
    
    const json = await response.json();
    
    // データ構造: [timestamp, open, high, low, close, volume]
    const data = json.data?.attributes?.ohlcv_list;

    if (!data || data.length === 0) {
      console.log('❌ データが見つかりませんでした。アドレスまたはネットワークを確認してください。');
      return;
    }

    console.log(`\n=== 📊 直近24時間のチャートデータ (1時間足) ===`);
    
    // データは新しい順に来るので逆順にして時系列に
    const candles = data.reverse();
    let sumClose = 0;

    candles.forEach((candle: any) => {
      const [ts, open, high, low, close, vol] = candle;
      const date = new Date(ts * 1000).toLocaleString();

      console.log(`[${date}]`);
      console.log(`  Close: ${close.toFixed(2)} USDC`); // 小数点2桁表示
      console.log(`-------------------------`);
      
      sumClose += close;
    });

    // 単純移動平均 (SMA)
    const avg = sumClose / candles.length;
    const currentPrice = candles[candles.length - 1][4]; // 最新のClose

    console.log(`\n📈 24時間移動平均 (SMA): ${avg.toFixed(2)} USDC`);
    console.log(`   現在値: ${currentPrice.toFixed(2)} USDC`);

  } catch (e) {
    console.error('Fetch Error:', e);
  }
}

main();