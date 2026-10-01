"""Demand forecast for the capacity outlook: the Datathon Task 2A model (daily, per depot x brand, summed to ISO weeks).

The same code as datathon/src/demand.py. In backtests it was off by 3.7% of weekly volume on average, against 9.5%
for "same week last year x growth".

Why daily: festivals move between ISO weeks from year to year (Vesak fell in week 21 of 2024, week 20 of 2025 and week
18 of 2026), and closed days (Sundays, New Year, May Day) remove a day of orders from a week. A daily model on the
supplied calendar handles both; the week total is the sum of its days.

Model: volume(series, day) = trend(series, day) x calendar_effect(day features)
  * trend: log-linear growth per series, fitted on ordinary days (no festival ramp, operating, not payday);
  * calendar_effect: gradient-boosted trees on the ratio volume / trend, with festival, payday, weekday and closure
    features shared across series (brand and depot are features, so the trees can learn brand-specific effects).
Chilled volume (Fresh only) is modelled the same way as its own target.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

SERIES = ["depot", "brand"]


def orders_for_demand(deliveries: pd.DataFrame, task1_inputs: pd.DataFrame) -> pd.DataFrame:
    """Every order counts once, deferred and never-run included, on the date the store asked for (order_date)."""
    o = pd.concat([deliveries, task1_inputs], ignore_index=True)
    assert o.delivery_id.is_unique, "an order appears twice"
    o["chilled_volume_m3"] = np.where(o.temp_requirement == "chilled", o.order_volume_m3, 0.0)
    return o


def daily_frame(orders: pd.DataFrame, calendar: pd.DataFrame, end: str | None = None) -> pd.DataFrame:
    """One row per series x calendar day (zero on days without orders), with calendar features."""
    cal = calendar_features(calendar)
    last = end or orders.order_date.max()
    cal = cal[(cal.date >= orders.order_date.min()) & (cal.date <= last)]
    series = orders[SERIES].drop_duplicates()
    grid = series.merge(cal, how="cross")
    agg = orders.groupby(["order_date", *SERIES]).agg(total=("order_volume_m3", "sum"), chilled=("chilled_volume_m3", "sum")).reset_index()
    grid = grid.merge(agg.rename(columns={"order_date": "date"}), on=["date", *SERIES], how="left")
    grid[["total", "chilled"]] = grid[["total", "chilled"]].fillna(0.0)
    return grid


def calendar_features(calendar: pd.DataFrame) -> pd.DataFrame:
    c = calendar.copy().sort_values("date").reset_index(drop=True)
    d = pd.to_datetime(c.date)
    c["t"] = (d - pd.Timestamp("2024-01-01")).dt.days
    c["doy"] = d.dt.dayofyear
    c["dom"] = d.dt.day
    c["month"] = d.dt.month
    # Which festival is coming, and how far away (the ramp says how close, not which one).
    fest = c.festival.where(c.festival.notna())
    c["next_festival"] = fest.bfill()
    c["days_to_festival"] = (pd.to_datetime(c.date.where(fest.notna()).bfill()) - d).dt.days
    c["days_since_festival"] = (d - pd.to_datetime(c.date.where(fest.notna()).ffill())).dt.days
    c["next_festival"] = c.next_festival.where(c.days_to_festival <= 14, "none")
    # Closures move orders to neighbouring days.
    c["closed_tomorrow"] = (c.is_operating.shift(-1) == 0).astype(int)
    c["closed_yesterday"] = (c.is_operating.shift(1) == 0).astype(int)
    c["closed_in_2_days"] = (c.is_operating.shift(-2) == 0).astype(int)
    c["payday_window"] = c.is_payday.rolling(3, center=True, min_periods=1).max()
    return c


FEATURES = ["depot", "brand", "dow", "is_operating", "is_payday", "payday_window", "festival_ramp", "is_holiday", "monsoon", "doy",
            "dom", "month", "next_festival", "days_to_festival", "days_since_festival", "closed_tomorrow", "closed_yesterday", "closed_in_2_days"]
CATS = ["depot", "brand", "next_festival"]


def _ordinary(df):
    return (df.is_operating == 1) & (df.festival_ramp == 0) & (df.is_payday == 0) & (df.is_holiday == 0) & (df.days_since_festival > 7)


class DemandModel:
    def __init__(self, target: str, trend_weeks: int = 10_000, seed: int = 0):
        self.target, self.trend_weeks, self.seed = target, trend_weeks, seed

    def _trend(self, df):
        out = np.zeros(len(df))
        for key, (a, b) in self.trend_.items():
            m = (df.depot == key[0]).values & (df.brand == key[1]).values
            out[m] = np.exp(a + b * df.t.values[m])
        return out

    def _X(self, df):
        X = df[FEATURES].copy()
        for c in CATS:
            X[c] = pd.Categorical(X[c], categories=self.cats_[c]).codes.astype(float)
        return X

    def fit(self, df: pd.DataFrame):
        df = df[(df.brand == "Fresh") | (self.target == "total")]
        # Log-linear growth per series over ordinary days (all history by default: the backtests favour it).
        self.trend_ = {}
        recent = df[df.t > df.t.max() - 7 * self.trend_weeks]
        for key, g in recent[_ordinary(recent)].groupby(SERIES):
            y = g[self.target].clip(lower=1e-3)
            b, a = np.polyfit(g.t, np.log(y), 1, w=np.sqrt(y))
            self.trend_[key] = (a, b)
        self.cats_ = {c: sorted(df[c].astype(str).unique()) for c in CATS}
        base = self._trend(df)
        self.model_ = HistGradientBoostingRegressor(loss="squared_error", max_iter=400, learning_rate=0.04, max_leaf_nodes=15, min_samples_leaf=20,
                                                    l2_regularization=1.0, categorical_features=[c in CATS for c in FEATURES], random_state=self.seed)
        self.model_.fit(self._X(df), df[self.target] / base, sample_weight=base / base.mean())
        return self

    def predict_daily(self, df: pd.DataFrame) -> np.ndarray:
        p = np.clip(self.model_.predict(self._X(df)), 0, None) * self._trend(df)
        p[df.is_operating.values == 0] = 0.0
        if self.target == "chilled":
            p[(df.brand != "Fresh").values] = 0.0
        return p


def weekly(df: pd.DataFrame, values: dict) -> pd.DataFrame:
    w = df[[*SERIES, "iso_year", "iso_week"]].assign(**values)
    return w.groupby([*SERIES, "iso_year", "iso_week"], as_index=False)[list(values)].sum()


def future_frame(series: pd.DataFrame, calendar: pd.DataFrame, weeks: pd.DataFrame) -> pd.DataFrame:
    cal = calendar_features(calendar)
    cal = cal.merge(weeks[["iso_year", "iso_week"]].drop_duplicates(), on=["iso_year", "iso_week"])
    return series.merge(cal, how="cross")
