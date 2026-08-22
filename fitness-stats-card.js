const ENTITY_META = {
  distance: { statType: 'total', icon: 'mdi:map-marker-distance', label: 'Distance' },
  calories: { statType: 'total', icon: 'mdi:fire', label: 'Calories' },
  time: { statType: 'total', icon: 'mdi:timer-outline', label: 'Time' },
  speed: { statType: 'measurement', icon: 'mdi:speedometer', label: 'Speed' },
  power: { statType: 'measurement', icon: 'mdi:lightning-bolt', label: 'Power' },
  heart_rate: { statType: 'measurement', icon: 'mdi:heart-pulse', label: 'Heart Rate' },
  cadence: { statType: 'measurement', icon: 'mdi:sync', label: 'Cadence' },
  step_rate: { statType: 'measurement', icon: 'mdi:shoe-print', label: 'Step Rate' },
  stroke_rate: { statType: 'measurement', icon: 'mdi:rowing', label: 'Stroke Rate' },
  resistance: { statType: 'measurement', icon: 'mdi:tune-vertical', label: 'Resistance' },
};

const SUMMARY_KEYS = ['distance', 'calories', 'time'];
const PERIOD_TYPES = ['week', 'month', 'year'];

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatValue(value, metricKey, unit) {
  if (value == null || isNaN(value)) return '0';
  if (metricKey === 'time') return formatDuration(value);
  if (metricKey === 'distance' && unit === 'm') {
    return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
  }
  if (Math.abs(value) >= 100) return Math.round(value).toLocaleString();
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(1);
}

function formatCompact(value, metricKey, unit) {
  if (metricKey === 'time') return formatDuration(value);
  if (metricKey === 'distance' && unit === 'm') {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}` : `${Math.round(value)}`;
  }
  if (Math.abs(value) >= 100) return Math.round(value).toLocaleString();
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(1);
}

function startToDate(start) {
  return typeof start === 'number' ? new Date(start * 1000) : new Date(start);
}

function dateToKey(d, yearly) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  if (yearly) return `${y}-${m}`;
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

class FitnessStatsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._offset = 0;
    this._periodType = 'week';
    this._selectedMetric = null;
    this._currentStats = null;
    this._previousStats = null;
    this._entityToMetric = {};
    this._units = {};
    this._refreshInterval = null;
  }

  static getStubConfig() {
    return {
      name: 'Fitness Stats',
      entities: { distance: '', calories: '', time: '' },
      default_period: 'week',
    };
  }

  setConfig(config) {
    if (!config.entities || typeof config.entities !== 'object') {
      throw new Error('Please define entities');
    }
    this._config = {
      name: config.name || 'Fitness Stats',
      entities: config.entities,
      goals: config.goals || {},
      default_period: config.default_period || 'week',
    };
    this._periodType = this._config.default_period;
    this._entityToMetric = {};
    for (const [key, id] of Object.entries(this._config.entities)) {
      if (id) this._entityToMetric[id] = key;
    }
    if (!this._selectedMetric) {
      this._selectedMetric = this._getAvailableMetrics()[0] || null;
    }
    if (this._hass) this._fetchData();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._config) {
      for (const [key, id] of Object.entries(this._config.entities)) {
        if (id && hass.states[id]) {
          this._units[key] = hass.states[id].attributes.unit_of_measurement || '';
        }
      }
    }
    if (!this._selectedMetric) {
      this._selectedMetric = this._getAvailableMetrics()[0] || null;
    }
    if (first && this._config) this._fetchData();
  }

  getCardSize() {
    return 8;
  }

  connectedCallback() {
    this._refreshInterval = setInterval(() => this._fetchData(), 300000);
    if (this._hass && this._config) this._fetchData();
  }

  disconnectedCallback() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
  }

  _getAvailableMetrics() {
    return Object.keys(this._config.entities).filter(
      (k) => this._config.entities[k] && ENTITY_META[k],
    );
  }

  // --- Period ---

  _getPeriodRange(type, offset) {
    const now = new Date();
    let start, end;
    if (type === 'week') {
      const day = now.getDay();
      const toMon = day === 0 ? 6 : day - 1;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - toMon);
      start.setDate(start.getDate() + offset * 7);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
    } else if (type === 'month') {
      start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
    } else {
      start = new Date(now.getFullYear() + offset, 0, 1);
      end = new Date(now.getFullYear() + offset + 1, 0, 1);
    }
    return { start, end };
  }

  _getPeriodLabel() {
    const { start, end } = this._getPeriodRange(this._periodType, this._offset);
    if (this._periodType === 'week') {
      const last = new Date(end);
      last.setDate(last.getDate() - 1);
      const s = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const e = last.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      return `${s} – ${e}`;
    }
    if (this._periodType === 'month') {
      return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    return start.getFullYear().toString();
  }

  // --- Data ---

  async _fetchData() {
    if (!this._hass || !this._config) return;
    const ids = Object.values(this._config.entities).filter(Boolean);
    if (ids.length === 0) return;

    const cur = this._getPeriodRange(this._periodType, this._offset);
    const prev = this._getPeriodRange(this._periodType, this._offset - 1);
    const period = this._periodType === 'year' ? 'month' : 'day';

    try {
      const [currentStats, previousStats] = await Promise.all([
        this._hass.callWS({
          type: 'recorder/statistics_during_period',
          start_time: cur.start.toISOString(),
          end_time: cur.end.toISOString(),
          statistic_ids: ids,
          period,
        }),
        this._hass.callWS({
          type: 'recorder/statistics_during_period',
          start_time: prev.start.toISOString(),
          end_time: prev.end.toISOString(),
          statistic_ids: ids,
          period,
        }),
      ]);
      console.debug('fitness-stats-card: fetched', {
        period: this._periodType,
        offset: this._offset,
        ids,
        currentKeys: Object.keys(currentStats || {}),
        currentEntries: Object.fromEntries(
          Object.entries(currentStats || {}).map(([k, v]) => [k, v.length]),
        ),
      });
      this._currentStats = currentStats;
      this._previousStats = previousStats;
      this._currentRange = cur;
      this._render();
    } catch (err) {
      console.error('fitness-stats-card: fetch failed', err);
      this.shadowRoot.innerHTML =
        '<ha-card><div style="padding:16px;color:var(--error-color)">Failed to load statistics</div></ha-card>';
    }
  }

  _getTotal(stats, key) {
    const id = this._config.entities[key];
    if (!id || !stats?.[id]) return 0;
    const meta = ENTITY_META[key];
    const entries = stats[id];
    if (meta.statType === 'total') {
      return entries.reduce((s, e) => s + (e.change || 0), 0);
    }
    const active = entries.filter((e) => e.mean != null && e.mean !== 0);
    if (active.length === 0) return 0;
    return active.reduce((s, e) => s + e.mean, 0) / active.length;
  }

  _countSessions(stats) {
    const ids = Object.entries(this._config.entities)
      .filter(([k]) => ENTITY_META[k]?.statType === 'total')
      .map(([, id]) => id)
      .filter(Boolean);
    const days = new Set();
    for (const id of ids) {
      for (const e of stats?.[id] || []) {
        if ((e.change || 0) > 0) {
          days.add(dateToKey(startToDate(e.start), false));
        }
      }
    }
    return days.size;
  }

  _chartValue(value, key) {
    if (key === 'time') return value / 60;
    if (key === 'distance' && this._units[key] === 'm') return value / 1000;
    return value;
  }

  _chartUnit(key) {
    if (key === 'time') return 'min';
    if (key === 'distance' && this._units[key] === 'm') return 'km';
    return this._units[key] || '';
  }

  _getChartData(key) {
    const id = this._config.entities[key];
    if (!id || !this._currentStats?.[id]) return [];
    const meta = ENTITY_META[key];
    const entries = this._currentStats[id];
    const yearly = this._periodType === 'year';

    const valueMap = {};
    for (const e of entries) {
      const dk = dateToKey(startToDate(e.start), yearly);
      const v = meta.statType === 'total' ? (e.change || 0) : (e.mean || 0);
      valueMap[dk] = (valueMap[dk] || 0) + v;
    }

    const { start, end } = this._currentRange;
    const keys = [];
    if (yearly) {
      for (let m = 0; m < 12; m++) {
        const d = new Date(start.getFullYear(), m, 1);
        keys.push(dateToKey(d, true));
      }
    } else {
      const d = new Date(start);
      while (d < end) {
        keys.push(dateToKey(d, false));
        d.setDate(d.getDate() + 1);
      }
    }
    return keys.map((dk) => ({
      key: dk,
      value: this._chartValue(valueMap[dk] || 0, key),
    }));
  }

  _getBarLabel(dateKey, index) {
    if (this._periodType === 'year') {
      return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][index] || '';
    }
    if (this._periodType === 'week') {
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index] || '';
    }
    return String(parseInt(dateKey.substring(8, 10)));
  }

  _shouldShowLabel(index, total) {
    if (total <= 14) return true;
    const day = index + 1;
    return day === 1 || day % 5 === 0;
  }

  _niceMax(maxValue, steps) {
    steps = steps || 4;
    if (maxValue <= 0) return steps;
    const rawStep = maxValue / steps;
    const order = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const frac = rawStep / order;
    let niceStep;
    if (frac <= 1) niceStep = order;
    else if (frac <= 2) niceStep = 2 * order;
    else if (frac <= 2.5) niceStep = 2.5 * order;
    else if (frac <= 5) niceStep = 5 * order;
    else niceStep = 10 * order;
    return niceStep * steps;
  }

  _getAverages() {
    const sessions = this._countSessions(this._currentStats);
    if (sessions === 0) return {};
    const avgs = {};
    for (const key of this._getAvailableMetrics()) {
      const meta = ENTITY_META[key];
      const total = this._getTotal(this._currentStats, key);
      if (meta.statType === 'total') {
        avgs[key] = total / sessions;
      } else if (total > 0) {
        avgs[key] = total;
      }
    }
    return avgs;
  }

  _getBests() {
    const bests = {};
    for (const key of this._getAvailableMetrics()) {
      const id = this._config.entities[key];
      if (!this._currentStats?.[id]) continue;
      const meta = ENTITY_META[key];
      const entries = this._currentStats[id];
      if (meta.statType === 'total') {
        const max = Math.max(0, ...entries.map((e) => e.change || 0));
        if (max > 0) bests[key] = max;
      } else {
        const max = Math.max(0, ...entries.map((e) => e.max || 0));
        if (max > 0) bests[key] = max;
      }
    }
    return bests;
  }

  // --- Render ---

  _render() {
    if (!this._hass || !this._config) {
      this.shadowRoot.innerHTML = '<ha-card><div style="padding:16px">Configuring...</div></ha-card>';
      return;
    }
    if (!this._currentStats) {
      this.shadowRoot.innerHTML = `
        <style>${this._getStyles()}</style>
        <ha-card><div class="card-content">
          ${this._renderHeader()}
          <div class="empty">Loading statistics...</div>
        </div></ha-card>`;
      this._attachListeners();
      return;
    }

    const sessions = this._countSessions(this._currentStats);
    const prevSessions = this._countSessions(this._previousStats);

    this.shadowRoot.innerHTML = `
      <style>${this._getStyles()}</style>
      <ha-card>
        <div class="card-content">
          ${this._renderHeader()}
          ${this._renderSummary(sessions, prevSessions)}
          ${this._renderChart()}
          ${this._renderGoals(sessions)}
          ${this._renderAveragesBests()}
        </div>
      </ha-card>
    `;
    this._attachListeners();
  }

  _renderHeader() {
    const label = this._getPeriodLabel();
    const tabs = PERIOD_TYPES.map(
      (t) =>
        `<button class="period-btn${t === this._periodType ? ' active' : ''}" data-period="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`,
    ).join('');

    return `
      <div class="header">
        <div class="header-top">
          <span class="header-title">${this._config.name}</span>
          <div class="period-tabs">${tabs}</div>
        </div>
        <div class="header-nav">
          <button class="nav-btn" data-dir="-1" aria-label="Previous">&#9664;</button>
          <span class="period-label">${label}</span>
          <button class="nav-btn" data-dir="1"${this._offset >= 0 ? ' disabled' : ''} aria-label="Next">&#9654;</button>
        </div>
      </div>`;
  }

  _renderSummary(sessions, prevSessions) {
    const items = [];
    items.push(this._summaryItem('Sessions', String(sessions), '', sessions - prevSessions, ''));

    for (const key of SUMMARY_KEYS) {
      if (!this._config.entities[key]) continue;
      const cur = this._getTotal(this._currentStats, key);
      const prev = this._getTotal(this._previousStats, key);
      const unit = this._units[key] || '';
      items.push(
        this._summaryItem(ENTITY_META[key].label, formatValue(cur, key, unit), unit, cur - prev, key),
      );
      if (items.length >= 4) break;
    }
    return `<div class="summary">${items.join('')}</div>`;
  }

  _summaryItem(label, value, unit, delta, key) {
    let deltaHtml = '<span class="delta neutral">&mdash;</span>';
    if (Math.abs(delta) > 0.01) {
      const arrow = delta > 0 ? '&#9650;' : '&#9660;';
      const cls = delta > 0 ? 'positive' : 'negative';
      const dv = key === 'time' ? formatDuration(Math.abs(delta)) : formatCompact(Math.abs(delta), key, unit);
      deltaHtml = `<span class="delta ${cls}">${arrow}${dv}</span>`;
    }
    return `
      <div class="summary-item">
        <div class="summary-value">${value}</div>
        <div class="summary-label">${label}</div>
        ${deltaHtml}
      </div>`;
  }

  _renderChart() {
    if (!this._selectedMetric) return '';
    const data = this._getChartData(this._selectedMetric);
    if (data.length === 0) return '<div class="chart-section">No data</div>';

    const maxVal = Math.max(...data.map((d) => d.value), 0);
    const niceMax = this._niceMax(maxVal, 4);
    const W = 500, H = 150, PL = 45, PR = 10, PT = 10, PB = 25;
    const cW = W - PL - PR, cH = H - PT - PB;
    const n = data.length;
    const gap = n > 20 ? 1 : 3;
    const bW = Math.max(2, (cW - gap * (n - 1)) / n);

    let grid = '', yLabels = '';
    for (let i = 0; i <= 4; i++) {
      const val = (niceMax / 4) * i;
      const y = PT + cH - (cH * val) / niceMax;
      if (i > 0) {
        grid += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="var(--divider-color,#e0e0e0)" stroke-width="0.5"/>`;
      }
      const lv = val >= 100 ? Math.round(val) : Number(val.toFixed(1));
      yLabels += `<text x="${PL - 5}" y="${y + 4}" text-anchor="end" fill="var(--secondary-text-color)" font-size="10">${lv}</text>`;
    }

    let bars = '', xLabels = '';
    for (let i = 0; i < n; i++) {
      const d = data[i];
      const x = PL + i * (bW + gap);
      if (d.value > 0) {
        const h = Math.max(2, (cH * d.value) / niceMax);
        const y = PT + cH - h;
        const r = Math.min(3, bW / 2);
        bars += `<rect x="${x}" y="${y}" width="${bW}" height="${h}" rx="${r}" ry="${r}" fill="var(--primary-color)" opacity="0.85"/>`;
      }
      if (this._shouldShowLabel(i, n)) {
        const lb = this._getBarLabel(d.key, i);
        xLabels += `<text x="${x + bW / 2}" y="${H - 5}" text-anchor="middle" fill="var(--secondary-text-color)" font-size="${n > 20 ? 8 : 10}">${lb}</text>`;
      }
    }

    const metricTabs = this._getAvailableMetrics()
      .map(
        (k) =>
          `<button class="metric-btn${k === this._selectedMetric ? ' active' : ''}" data-metric="${k}">${ENTITY_META[k].label}</button>`,
      )
      .join('');

    const yUnit = this._chartUnit(this._selectedMetric);

    return `
      <div class="chart-section">
        <div class="metric-tabs">${metricTabs}</div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="chart-svg" role="img" aria-label="Statistics chart">
          ${grid}${yLabels}${bars}${xLabels}
          <text x="${PL - 5}" y="${PT - 2}" text-anchor="end" fill="var(--secondary-text-color)" font-size="9">${yUnit}</text>
        </svg>
      </div>`;
  }

  _renderGoals(sessions) {
    const goals = this._config.goals;
    if (!goals || Object.keys(goals).length === 0) return '';
    if (this._periodType !== 'week') return '';

    let rows = '';
    if (goals.sessions) {
      const pct = Math.min(100, (sessions / goals.sessions) * 100);
      rows += this._goalRow('Sessions', sessions, goals.sessions, pct);
    }
    for (const key of SUMMARY_KEYS) {
      if (!goals[key] || !this._config.entities[key]) continue;
      const cur = this._getTotal(this._currentStats, key);
      const target = goals[key];
      const pct = Math.min(100, (cur / target) * 100);
      const unit = this._units[key] || '';
      const cv = formatCompact(cur, key, unit);
      const tv = formatCompact(target, key, unit);
      rows += this._goalRow(ENTITY_META[key].label, cv, tv, pct);
    }
    if (!rows) return '';

    return `
      <div class="goals-section">
        <div class="section-title">Goals</div>
        ${rows}
      </div>`;
  }

  _goalRow(label, current, target, pct) {
    const done = pct >= 100;
    return `
      <div class="goal-row">
        <span class="goal-label">${label}</span>
        <div class="goal-track"><div class="goal-fill${done ? ' done' : ''}" style="width:${pct}%"></div></div>
        <span class="goal-value${done ? ' done' : ''}">${current}/${target}</span>
      </div>`;
  }

  _renderAveragesBests() {
    const avgs = this._getAverages();
    const bests = this._getBests();
    const hasAvgs = Object.keys(avgs).length > 0;
    const hasBests = Object.keys(bests).length > 0;
    if (!hasAvgs && !hasBests) return '';

    const renderCol = (title, data) => {
      let rows = '';
      for (const [key, val] of Object.entries(data)) {
        if (!ENTITY_META[key]) continue;
        const unit = this._units[key] || '';
        const fv = formatValue(val, key, unit);
        const uSuffix = key !== 'time' && key !== 'distance' ? ` ${unit}` : '';
        rows += `<div class="stat-row"><span class="stat-label">${ENTITY_META[key].label}</span><span class="stat-value">${fv}${uSuffix}</span></div>`;
      }
      return `<div class="stats-col"><div class="section-title">${title}</div>${rows}</div>`;
    };

    return `
      <div class="stats-section">
        ${hasAvgs ? renderCol('Averages', avgs) : ''}
        ${hasBests ? renderCol('Personal Bests', bests) : ''}
      </div>`;
  }

  // --- Events ---

  _attachListeners() {
    this.shadowRoot.querySelectorAll('.period-btn').forEach((b) =>
      b.addEventListener('click', () => {
        this._periodType = b.dataset.period;
        this._offset = 0;
        this._fetchData();
      }),
    );
    this.shadowRoot.querySelectorAll('.nav-btn').forEach((b) =>
      b.addEventListener('click', () => {
        const dir = parseInt(b.dataset.dir);
        if (dir > 0 && this._offset >= 0) return;
        this._offset += dir;
        this._fetchData();
      }),
    );
    this.shadowRoot.querySelectorAll('.metric-btn').forEach((b) =>
      b.addEventListener('click', () => {
        this._selectedMetric = b.dataset.metric;
        this._render();
      }),
    );
  }

  // --- Styles ---

  _getStyles() {
    return `
      .card-content { padding: 16px; }

      .header { margin-bottom: 16px; }
      .header-top {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 8px;
      }
      .header-title {
        font-size: 1.1em; font-weight: 500;
        color: var(--primary-text-color);
      }
      .period-tabs { display: flex; gap: 4px; }
      .period-btn {
        background: none; border: 1px solid var(--divider-color,#e0e0e0);
        border-radius: 16px; padding: 3px 12px; font-size: 0.78em;
        cursor: pointer; color: var(--primary-text-color);
        font-family: inherit;
      }
      .period-btn.active {
        background: var(--primary-color); color: var(--text-primary-color,#fff);
        border-color: var(--primary-color);
      }
      .header-nav {
        display: flex; align-items: center; justify-content: center; gap: 12px;
      }
      .nav-btn {
        background: none; border: none; color: var(--primary-color);
        font-size: 0.9em; cursor: pointer; padding: 4px 8px; border-radius: 4px;
      }
      .nav-btn:hover:not(:disabled) { background: var(--secondary-background-color,rgba(0,0,0,0.05)); }
      .nav-btn:disabled { opacity: 0.3; cursor: default; }
      .period-label {
        font-size: 0.9em; font-weight: 500; min-width: 150px;
        text-align: center; color: var(--primary-text-color);
      }

      .summary {
        display: flex; justify-content: space-around; flex-wrap: wrap;
        padding: 12px 0; border-bottom: 1px solid var(--divider-color,#e0e0e0);
        margin-bottom: 12px;
      }
      .summary-item { text-align: center; min-width: 60px; padding: 4px; }
      .summary-value {
        font-size: 1.25em; font-weight: 600; color: var(--primary-text-color);
        line-height: 1.2;
      }
      .summary-label {
        font-size: 0.72em; color: var(--secondary-text-color); margin-top: 2px;
      }
      .delta { font-size: 0.68em; display: block; margin-top: 2px; }
      .delta.positive { color: var(--label-badge-green,#4caf50); }
      .delta.negative { color: var(--label-badge-red,#f44336); }
      .delta.neutral { color: var(--secondary-text-color); }

      .chart-section { margin: 12px 0; }
      .metric-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
      .metric-btn {
        background: none; border: 1px solid var(--divider-color,#e0e0e0);
        border-radius: 12px; padding: 2px 10px; font-size: 0.72em;
        cursor: pointer; color: var(--secondary-text-color); font-family: inherit;
      }
      .metric-btn.active {
        background: var(--primary-color); color: var(--text-primary-color,#fff);
        border-color: var(--primary-color);
      }
      .chart-svg { width: 100%; height: auto; }

      .goals-section {
        margin: 12px 0; padding-top: 12px;
        border-top: 1px solid var(--divider-color,#e0e0e0);
      }
      .section-title {
        font-size: 0.82em; font-weight: 500;
        color: var(--secondary-text-color); margin-bottom: 8px;
      }
      .goal-row {
        display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
      }
      .goal-label { font-size: 0.8em; color: var(--primary-text-color); min-width: 65px; }
      .goal-track {
        flex: 1; height: 8px; border-radius: 4px; overflow: hidden;
        background: var(--secondary-background-color,rgba(0,0,0,0.08));
      }
      .goal-fill {
        height: 100%; border-radius: 4px; background: var(--primary-color);
        transition: width 0.3s ease;
      }
      .goal-fill.done { background: var(--label-badge-green,#4caf50); }
      .goal-value {
        font-size: 0.72em; color: var(--secondary-text-color);
        min-width: 70px; text-align: right;
      }
      .goal-value.done { color: var(--label-badge-green,#4caf50); }

      .stats-section {
        display: flex; gap: 24px; padding-top: 12px;
        border-top: 1px solid var(--divider-color,#e0e0e0);
      }
      .stats-col { flex: 1; }
      .stat-row {
        display: flex; justify-content: space-between;
        padding: 3px 0; font-size: 0.82em;
      }
      .stat-label { color: var(--secondary-text-color); }
      .stat-value { font-weight: 500; color: var(--primary-text-color); }

      .empty {
        text-align: center; padding: 32px 16px;
        color: var(--secondary-text-color); font-size: 0.9em;
      }
    `;
  }
}

customElements.define('fitness-stats-card', FitnessStatsCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'fitness-stats-card',
  name: 'Fitness Stats Card',
  description: 'Training statistics with period navigation for fitness machines',
});
