import 'dotenv/config';

const apiKey = process.env.GRAPH_API_KEY ?? '';
const subgraphId = process.env.SUBGRAPH_ID ?? '';
const poolAddress = (process.env.POOL_ADDRESS ?? '').toLowerCase();

if (!apiKey) {
  throw new Error('GRAPH_API_KEY missing');
}
if (!subgraphId) {
  throw new Error('SUBGRAPH_ID missing');
}
if (!poolAddress) {
  throw new Error('POOL_ADDRESS missing');
}

const ENDPOINT = `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;
const POOL_ADDRESS = poolAddress;

const query = `
{
  pool(id: "${POOL_ADDRESS}") {
    id
    token0 {
      symbol
      name
    }
    token1 {
      symbol
      name
    }
    token0Price
    token1Price
    sqrtPrice
    tick
    liquidity
  }
}
`;

async function fetchPoolData() {
  try {
    console.log(`Fetching data from: ${ENDPOINT}`);
    
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as {
      data?: { pool?: { token0: { symbol: string; name: string }; token1: { symbol: string; name: string }; token0Price: string; token1Price: string; tick: string; liquidity: string; id: string } };
      errors?: Array<{ message: string }>;
    };

    if (result.errors) {
      console.error("GraphQL Errors:", result.errors);
      return;
    }

    const pool = result.data?.pool;
    
    if (!pool) {
      console.log("Pool not found. Please check the address.");
      return;
    }

    console.log(`\n=== Pool Data: ${pool.token0.symbol} / ${pool.token1.symbol} ===`);
    console.log(`Pool Address: ${pool.id}`);
    console.log(`Price (${pool.token0.symbol} per ${pool.token1.symbol}): ${pool.token0Price}`);
    console.log(`Price (${pool.token1.symbol} per ${pool.token0.symbol}): ${pool.token1Price}`);
    console.log(`Current Tick: ${pool.tick}`);
    console.log(`Liquidity: ${pool.liquidity}`);

  } catch (error) {
    console.error("Fetch Failed:", error);
  }
}

fetchPoolData();
