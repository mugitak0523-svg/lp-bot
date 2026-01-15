import asyncio
import os
from dataclasses import dataclass
from decimal import Decimal, ROUND_FLOOR
from typing import List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from x10.perpetual.accounts import StarkPerpetualAccount
from x10.perpetual.configuration import MAINNET_CONFIG, TESTNET_CONFIG
from x10.perpetual.order_object import create_order_object
from x10.perpetual.orders import OrderSide, OrderType, TimeInForce
from x10.perpetual.trades import AccountTradeModel, TradeType
from x10.perpetual.trading_client import PerpetualTradingClient

load_dotenv()


@dataclass(frozen=True)
class Settings:
    api_key: str
    public_key: str
    private_key: str
    vault_id: int
    environment: str


class MarketOrderRequest(BaseModel):
    side: Literal["BUY", "SELL"]
    size: Decimal = Field(..., gt=0)
    market: str = "ETH-USD"
    max_slippage_pct: Decimal = Field(default=Decimal("0.05"), ge=0)
    reduce_only: bool = False


class MarketOrderResponse(BaseModel):
    order_id: int
    external_id: str
    market: str
    side: str
    size: Decimal
    worst_price: Decimal
    order: Optional[dict] = None
    retry_attempts: Optional[int] = None


async def fetch_order_with_retry(
    order_id: int, attempts: int = 5, delay_sec: float = 2.0
) -> tuple[Optional[dict], int]:
    for attempt in range(attempts):
        try:
            response = await trading_client.account.get_order_by_id(order_id=order_id)
            if response.data is not None:
                return response.data.model_dump(), attempt + 1
        except Exception:
            pass
        if attempt < attempts - 1:
            await asyncio.sleep(delay_sec)
    return None, attempts


async def fetch_order_with_trade_fallback(order_id: int) -> tuple[Optional[dict], int]:
    order_details, attempts_used = await fetch_order_with_retry(order_id, attempts=5, delay_sec=2.0)
    if order_details is not None:
        return order_details, attempts_used
    try:
        trades_response = await trading_client.account.get_trades(limit=10)
        for trade in trades_response.data or []:
            if trade.order_id == order_id:
                return {"trade": trade.model_dump()}, -1
    except Exception:
        pass
    return None, -1


class TradeHistoryResponse(BaseModel):
    trades: List[AccountTradeModel]
    cursor: Optional[int] = None
    count: Optional[int] = None


class OrderDetailResponse(BaseModel):
    order: Optional[dict] = None


def load_settings() -> Settings:
    api_key = os.getenv("X10_API_KEY")
    public_key = os.getenv("X10_PUBLIC_KEY")
    private_key = os.getenv("X10_PRIVATE_KEY")
    vault_id = os.getenv("X10_VAULT_ID")
    environment = os.getenv("X10_ENV", "TESTNET")

    if not api_key or not public_key or not private_key or not vault_id:
        raise RuntimeError("Missing X10_API_KEY, X10_PUBLIC_KEY, X10_PRIVATE_KEY, or X10_VAULT_ID")

    return Settings(
        api_key=api_key,
        public_key=public_key,
        private_key=private_key,
        vault_id=int(vault_id),
        environment=environment,
    )


settings = load_settings()
endpoint_config = TESTNET_CONFIG if settings.environment.upper() == "TESTNET" else MAINNET_CONFIG

stark_account = StarkPerpetualAccount(
    vault=settings.vault_id,
    private_key=settings.private_key,
    public_key=settings.public_key,
    api_key=settings.api_key,
)

trading_client = PerpetualTradingClient(
    endpoint_config=endpoint_config,
    stark_account=stark_account,
)

app = FastAPI(title="Extended Perp Market Order API")


@app.on_event("shutdown")
async def shutdown() -> None:
    await trading_client.close()


@app.post("/orders/market", response_model=MarketOrderResponse)
async def place_market_order(payload: MarketOrderRequest) -> MarketOrderResponse:
    if payload.max_slippage_pct > Decimal("0.05"):
        raise HTTPException(status_code=400, detail="max_slippage_pct must be <= 0.05 (5%)")

    side = OrderSide.BUY if payload.side == "BUY" else OrderSide.SELL

    market_response = await trading_client.markets_info.get_markets(market_names=[payload.market])
    if not market_response.data:
        raise HTTPException(status_code=404, detail=f"market not found: {payload.market}")

    market = market_response.data[0]
    stats = market.market_stats

    if side == OrderSide.BUY:
        reference_price = stats.ask_price or stats.mark_price
        worst_price = reference_price * (Decimal("1") + payload.max_slippage_pct)
    else:
        reference_price = stats.bid_price or stats.mark_price
        worst_price = reference_price * (Decimal("1") - payload.max_slippage_pct)

    if worst_price <= 0:
        raise HTTPException(status_code=400, detail="computed worst_price is invalid")

    rounded_price = market.trading_config.round_price(worst_price)
    rounded_size = market.trading_config.round_order_size(payload.size, rounding_direction=ROUND_FLOOR)

    if rounded_size <= 0:
        raise HTTPException(status_code=400, detail="rounded order size is too small")

    order = create_order_object(
        account=stark_account,
        market=market,
        amount_of_synthetic=rounded_size,
        price=rounded_price,
        side=side,
        time_in_force=TimeInForce.IOC,
        reduce_only=payload.reduce_only,
        starknet_domain=endpoint_config.starknet_domain,
    )
    market_order = order.model_copy(update={"type": OrderType.MARKET})

    try:
        placed = await trading_client.orders.place_order(market_order)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if not placed.data:
        raise HTTPException(status_code=502, detail="empty response from order placement")

    order_details, attempts_used = await fetch_order_with_trade_fallback(placed.data.id)

    return MarketOrderResponse(
        order_id=placed.data.id,
        external_id=placed.data.external_id,
        market=payload.market,
        side=payload.side,
        size=rounded_size,
        worst_price=rounded_price,
        order=order_details,
        retry_attempts=attempts_used,
    )


@app.get("/trades", response_model=TradeHistoryResponse)
async def get_trades(
    market: List[str] = Query(default=["ETH-USD"]),
    side: Optional[OrderSide] = None,
    trade_type: Optional[TradeType] = None,
    cursor: Optional[int] = None,
    limit: Optional[int] = Query(default=100, ge=1, le=500),
) -> TradeHistoryResponse:
    try:
        response = await trading_client.account.get_trades(
            market_names=market,
            trade_side=side,
            trade_type=trade_type,
            cursor=cursor,
            limit=limit,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    pagination = response.pagination
    return TradeHistoryResponse(
        trades=response.data or [],
        cursor=pagination.cursor if pagination else None,
        count=pagination.count if pagination else None,
    )


@app.get("/orders/{order_id}")
async def get_order_by_id(order_id: int) -> OrderDetailResponse:
    try:
        response = await trading_client.account.get_order_by_id(order_id=order_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if response.data is None:
        raise HTTPException(status_code=404, detail="order not found")

    return OrderDetailResponse(order=response.data.model_dump())
