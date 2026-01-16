import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import HTTPException
from x10.perpetual.orders import OrderSide
from x10.perpetual.trades import TradeType

MAX_SAFE_INT = 2**53 - 1

ROOT_DIR = Path(__file__).resolve().parents[2]
EXTENDED_APP_DIR = ROOT_DIR / "extended_example" / "app"
sys.path.insert(0, str(EXTENDED_APP_DIR))

from main import (  # noqa: E402
    MarketOrderRequest,
    get_trades,
    place_market_order,
    trading_client,
    fetch_order_with_trade_fallback,
)


def read_payload() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def stringify_large_ints(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: stringify_large_ints(val) for key, val in value.items()}
    if isinstance(value, list):
        return [stringify_large_ints(item) for item in value]
    if isinstance(value, int) and abs(value) > MAX_SAFE_INT:
        return str(value)
    return value


def parse_order_side(value: Optional[str]) -> Optional[OrderSide]:
    if not value:
        return None
    try:
        return OrderSide[value.upper()]
    except KeyError as exc:
        raise ValueError(f"invalid side: {value}") from exc


def parse_trade_type(value: Optional[str]) -> Optional[TradeType]:
    if not value:
        return None
    try:
        return TradeType[value.upper()]
    except KeyError as exc:
        raise ValueError(f"invalid trade_type: {value}") from exc


async def run() -> None:
    payload = read_payload()
    result: Dict[str, Any] = {"ok": False, "status_code": 400, "error": "command required"}
    try:
        if len(sys.argv) < 2:
            return
        command = sys.argv[1]
        if command == "market_order":
            request = MarketOrderRequest(**payload)
            response = await place_market_order(request)
            result = {"ok": True, "data": response.model_dump(mode="json")}
        elif command == "trades":
            market = payload.get("market") or ["ETH-USD"]
            if isinstance(market, str):
                market = [market]
            cursor = payload.get("cursor")
            limit = payload.get("limit")
            cursor_value = int(cursor) if isinstance(cursor, (int, str)) and str(cursor).isdigit() else None
            limit_value = int(limit) if isinstance(limit, (int, str)) and str(limit).isdigit() else None
            response = await get_trades(
                market=market,
                side=parse_order_side(payload.get("side")),
                trade_type=parse_trade_type(payload.get("trade_type")),
                cursor=cursor_value,
                limit=limit_value,
            )
            result = {"ok": True, "data": response.model_dump(mode="json")}
        elif command == "order_by_id":
            order_id = payload.get("order_id")
            if order_id is None:
                result = {"ok": False, "status_code": 400, "error": "order_id required"}
            else:
                try:
                    order_id_value = int(order_id)
                except (TypeError, ValueError):
                    result = {"ok": False, "status_code": 400, "error": f"invalid order_id: {order_id}"}
                else:
                    order_details, attempts_used = await fetch_order_with_trade_fallback(order_id_value)
                    if order_details is None:
                        result = {
                            "ok": False,
                            "status_code": 404,
                            "error": "order not found",
                            "retry_attempts": attempts_used,
                        }
                    else:
                        result = {
                            "ok": True,
                            "data": {"order": order_details, "retry_attempts": attempts_used},
                        }
        elif command == "mark_price":
            market = payload.get("market") or "ETH-USD"
            response = await trading_client.markets_info.get_markets(market_names=[market])
            if not response.data:
                result = {"ok": False, "status_code": 404, "error": f"market not found: {market}"}
            else:
                market_data = response.data[0]
                stats = market_data.market_stats
                stats_dump = stats.model_dump(mode="json") if hasattr(stats, "model_dump") else stats
                result = {"ok": True, "data": {"market": market, "stats": stats_dump}}
        else:
            result = {"ok": False, "status_code": 400, "error": f"unknown command: {command}"}
    except HTTPException as exc:
        result = {"ok": False, "status_code": exc.status_code, "error": str(exc.detail)}
    except ValueError as exc:
        result = {"ok": False, "status_code": 400, "error": str(exc)}
    except Exception as exc:
        result = {"ok": False, "status_code": 500, "error": str(exc)}
    finally:
        await trading_client.close()
    safe_result = stringify_large_ints(result)
    print(json.dumps(safe_result, default=str))


if __name__ == "__main__":
    asyncio.run(run())
