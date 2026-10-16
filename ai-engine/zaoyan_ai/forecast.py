"""Date-aware, explainable planning baseline. No future observations or synthetic sales."""
from __future__ import annotations
import argparse
from datetime import date, timedelta
import json
import math
from decimal import Decimal, ROUND_CEILING
from pathlib import Path


def forecast(samples: list[dict], buffer_rate: float = .08, target_date: str | None = None) -> dict:
    if not math.isfinite(buffer_rate) or not 0 <= buffer_rate <= .5:
        raise ValueError("缓冲率必须在 0 到 0.5 之间")
    target = date.fromisoformat(target_date) if target_date else date.today() + timedelta(days=1)
    # One observation per date. Invalid values are missing data, not zero demand.
    unique: dict[date, int] = {}
    for row in samples:
        try:
            day = date.fromisoformat(row['date'])
            value = row['quantity']
            if isinstance(value, bool) or value is None:
                continue
            quantity = float(value)
            if (not math.isfinite(quantity) or not quantity.is_integer() or quantity < 0
                    or quantity > 100000 or day >= target):
                continue
            unique[day] = int(quantity)
        except (ValueError, TypeError, KeyError, OverflowError):
            continue
    history = sorted(unique.items())[-28:]
    n = len(history)
    if n < 3:
        return {'enough_data': False, 'sample_size': n, 'target_date': target.isoformat(),
                'explanation': f'目标日期之前仅有 {n} 天同餐次人工核实数据，至少需要 3 天；不使用目标日、未来记录或计划量代替实际出餐。'}
    same_weekday = [(day, value) for day, value in history if day.weekday() == target.weekday()]
    chosen = same_weekday if len(same_weekday) >= 3 else history
    method = 'SAME_WEEKDAY_WEIGHTED' if len(same_weekday) >= 3 else 'RECENT_WEIGHTED'
    weights = list(range(1, len(chosen) + 1))
    total = sum(weights)
    estimate = sum(v * w for (_, v), w in zip(chosen, weights)) / total
    deviation = math.sqrt(sum(w * (v-estimate)**2 for (_, v), w in zip(chosen, weights)) / total)
    predicted = max(0, math.floor(estimate + .5))
    recommended = int((Decimal(predicted) * (1 + Decimal(str(buffer_rate))) / 5).to_integral_value(rounding=ROUND_CEILING)) * 5
    lower, upper = max(0, math.floor(estimate-deviation)), math.ceil(estimate+deviation)
    label = '同星期' if method == 'SAME_WEEKDAY_WEIGHTED' else '最近'
    return {'enough_data': True, 'sample_size': len(chosen), 'target_date': target.isoformat(),
            'predicted_qty': predicted, 'recommended_qty': recommended, 'lower_qty': lower, 'upper_qty': upper,
            'method': method, 'history_start': chosen[0][0].isoformat(), 'history_end': chosen[-1][0].isoformat(),
            'explanation': f'采用目标日前{label} {len(chosen)} 天同餐次核实出餐量，按时间递增加权；增加 {buffer_rate*100:.0f}% 缓冲并向上取整到 5 份。{lower}—{upper} 份为历史加权均值±1个标准差的波动参考，不是经过校准的预测置信区间。'}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    payload = json.loads(Path(args.input).read_text(encoding='utf-8'))
    result = forecast(payload.get('samples', []), float(payload.get('buffer_rate', .08)), payload.get('target_date'))
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
