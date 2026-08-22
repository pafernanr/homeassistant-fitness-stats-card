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
const PERIOD_TYPES = ['day', 'week', 'month', 'year'];
const VERSION = '0.3.1';

const LINE_COLORS = {
  speed: '#3498db',
  power: '#e74c3c',
  heart_rate: '#e91e63',
  cadence: '#2ecc71',
  step_rate: '#9b59b6',
  stroke_rate: '#f39c12',
  resistance: '#1abc9c',
  distance: '#3498db',
  calories: '#e67e22',
  time: '#16a085',
};

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
    this._visibleLines = new Set();
    this._drillFrom = null;
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
      goals: config.weekly_goals || {},
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
    if (this._visibleLines.size === 0) {
      for (const [key, id] of Object.entries(this._config.entities)) {
        if (id && ENTITY_META[key]?.statType === 'measurement') {
          this._visibleLines.add(key);
        }
      }
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
    if (type === 'day') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      end = new Date(start);
      end.setDate(end.getDate() + 1);
    } else if (type === 'week') {
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
    if (this._periodType === 'day') {
      return start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }
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
    this._currentRange = cur;
    const period = this._periodType === 'year' ? 'month' : this._periodType === 'day' ? 'hour' : 'day';

    try {
      const statsPromise = Promise.all([
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

      let historyPromise = Promise.resolve(null);
      if (this._periodType === 'day') {
        historyPromise = this._hass.callApi('GET',
          `history/period/${cur.start.toISOString()}?filter_entity_id=${ids.join(',')}&end_time=${cur.end.toISOString()}&minimal_response&no_attributes`
        ).catch(err => { console.warn('fitness-stats-card: history fetch failed', err); return null; });
      }

      const [[currentStats, previousStats], historyData] = await Promise.all([statsPromise, historyPromise]);

      this._currentStats = currentStats;
      this._previousStats = previousStats;
      this._dayHistory = this._parseDayHistory(historyData);

      console.debug('fitness-stats-card: fetched', {
        period: this._periodType,
        offset: this._offset,
        dayHistory: this._dayHistory ? Object.fromEntries(
          Object.entries(this._dayHistory).map(([k, v]) => [k, v.length])
        ) : null,
      });

      this._render();
    } catch (err) {
      console.error('fitness-stats-card: fetch failed', err);
      this.shadowRoot.innerHTML =
        '<ha-card><div style="padding:16px;color:var(--error-color)">Failed to load statistics</div></ha-card>';
    }
  }

  _getTotal(stats, key) {
    if (this._periodType === 'day' && stats === this._currentStats && this._dayHistory?.[key]?.length > 0) {
      const meta = ENTITY_META[key];
      if (meta.statType === 'total') {
        const sessions = this._splitIntoSessions(this._dayHistory[key]);
        let total = 0;
        for (const sess of sessions) {
          const vals = sess.map(d => d.value);
          total += Math.max(...vals) - Math.min(...vals);
        }
        return total;
      }
      const active = this._dayHistory[key].filter(d => d.value > 0);
      if (active.length === 0) return 0;
      return active.reduce((s, d) => s + d.value, 0) / active.length;
    }
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
    if (this._periodType === 'day' && stats === this._currentStats && this._dayHistory) {
      return this._detectSessions().length;
    }
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
    const isDay = this._periodType === 'day';
    const yearly = this._periodType === 'year';

    const valueMap = {};
    for (const e of entries) {
      let dk;
      if (isDay) {
        dk = String(startToDate(e.start).getHours());
      } else {
        dk = dateToKey(startToDate(e.start), yearly);
      }
      const v = meta.statType === 'total' ? (e.change || 0) : (e.mean || 0);
      valueMap[dk] = (valueMap[dk] || 0) + v;
    }

    const keys = [];
    if (isDay) {
      for (let h = 0; h < 24; h++) keys.push(String(h));
    } else if (yearly) {
      for (let m = 0; m < 12; m++) {
        const d = new Date(this._currentRange.start.getFullYear(), m, 1);
        keys.push(dateToKey(d, true));
      }
    } else {
      const { start, end } = this._currentRange;
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
    if (this._periodType === 'day') {
      return `${index}h`;
    }
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
    if (total === 24) return index % 3 === 0;
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

  // --- Drill-down ---

  _drillToDay(barIndex) {
    const { start } = this._currentRange;
    let target;
    if (this._periodType === 'year') {
      target = new Date(start.getFullYear(), barIndex, 1);
    } else {
      target = new Date(start);
      target.setDate(target.getDate() + barIndex);
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((target - today) / 86400000);
    this._drillFrom = { periodType: this._periodType, offset: this._offset };
    this._periodType = 'day';
    this._offset = diff;
    this._fetchData();
  }

  _drillBack() {
    if (!this._drillFrom) return;
    this._periodType = this._drillFrom.periodType;
    this._offset = this._drillFrom.offset;
    this._drillFrom = null;
    this._fetchData();
  }

  _getDayLineData(key) {
    const id = this._config.entities[key];
    if (!id || !this._currentStats?.[id]) return new Array(24).fill(null);
    const entries = this._currentStats[id];
    const meta = ENTITY_META[key];
    const hourData = new Array(24).fill(null);
    for (const e of entries) {
      const h = startToDate(e.start).getHours();
      const v = meta.statType === 'total' ? (e.change || 0) : (e.mean || 0);
      if (v > 0) hourData[h] = (hourData[h] || 0) + v;
    }
    return hourData;
  }

  _parseDayHistory(historyData) {
    if (!historyData) return null;
    const result = {};
    for (const entityHistory of historyData) {
      if (!entityHistory?.length) continue;
      const entityId = entityHistory[0].entity_id;
      const metricKey = this._entityToMetric[entityId];
      if (!metricKey) continue;
      result[metricKey] = entityHistory
        .filter(s => s.state !== 'unknown' && s.state !== 'unavailable')
        .map(s => ({ time: new Date(s.last_changed), value: parseFloat(s.state) }))
        .filter(d => !isNaN(d.value));
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  _splitIntoSessions(data, gapMs) {
    if (!data || data.length === 0) return [];
    gapMs = gapMs || 300000;
    const sorted = [...data].sort((a, b) => a.time.getTime() - b.time.getTime());
    const sessions = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].time.getTime() - sorted[i - 1].time.getTime() > gapMs) {
        sessions.push([]);
      }
      sessions[sessions.length - 1].push(sorted[i]);
    }
    return sessions;
  }

  _detectSessions() {
    if (!this._dayHistory) return [];
    const allTimes = [];
    for (const [key, data] of Object.entries(this._dayHistory)) {
      if (ENTITY_META[key]?.statType !== 'measurement') continue;
      for (const d of data) {
        if (d.value > 0) allTimes.push(d.time.getTime());
      }
    }
    if (allTimes.length === 0) return [];
    allTimes.sort((a, b) => a - b);
    const GAP = 300000;
    const sessions = [{ start: allTimes[0], end: allTimes[0] }];
    for (let i = 1; i < allTimes.length; i++) {
      const last = sessions[sessions.length - 1];
      if (allTimes[i] - last.end > GAP) {
        sessions.push({ start: allTimes[i], end: allTimes[i] });
      } else {
        last.end = allTimes[i];
      }
    }
    return sessions.filter(s => s.end - s.start >= 30000);
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
          ${this._renderSessionChart()}
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

    const backBtn = this._drillFrom
      ? `<button class="back-btn" data-action="back">&#9664; ${this._drillFrom.periodType[0].toUpperCase() + this._drillFrom.periodType.slice(1)}</button>`
      : '';

    return `
      <div class="header">
        <div class="header-top">
          <span class="header-title">${this._config.name}</span>
          <div class="period-tabs">${tabs}</div>
        </div>
        <div class="header-nav">
          ${backBtn}
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
    if (data.length === 0) return '<div class="chart-section empty">No data</div>';

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
    const clickable = this._periodType !== 'day';
    for (let i = 0; i < n; i++) {
      const d = data[i];
      const x = PL + i * (bW + gap);
      if (d.value > 0) {
        const h = Math.max(2, (cH * d.value) / niceMax);
        const y = PT + cH - h;
        const r = Math.min(3, bW / 2);
        bars += `<rect x="${x}" y="${y}" width="${bW}" height="${h}" rx="${r}" ry="${r}" fill="var(--primary-color)" opacity="0.85" class="chart-bar" data-bar-index="${i}"/>`;
      }
      if (clickable) {
        bars += `<rect x="${x}" y="${PT}" width="${bW}" height="${cH}" fill="transparent" class="chart-bar-hit" data-bar-index="${i}"/>`;
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

  _renderSessionChart() {
    if (this._periodType !== 'day' || !this._dayHistory) return '';

    const measMetrics = this._getAvailableMetrics().filter(
      (k) => ENTITY_META[k].statType === 'measurement',
    );
    if (measMetrics.length === 0) return '';

    const hasData = measMetrics.some(k => (this._dayHistory[k] || []).some(d => d.value > 0));
    if (!hasData) return '';

    const W = 500, H = 200, PL = 55, PR = 10, PT = 20, PB = 25;
    const cW = W - PL - PR, cH = H - PT - PB;

    let minTime = Infinity, maxTime = -Infinity;
    for (const key of measMetrics) {
      for (const d of (this._dayHistory[key] || [])) {
        if (d.value > 0) {
          const t = d.time.getTime();
          if (t < minTime) minTime = t;
          if (t > maxTime) maxTime = t;
        }
      }
    }
    if (minTime >= maxTime) return '';

    const rawMin = minTime, rawMax = maxTime;
    const pad = Math.max((maxTime - minTime) * 0.03, 5000);
    minTime -= pad;
    maxTime += pad;
    const range = maxTime - minTime;

    let grid = '';
    for (let i = 1; i <= 3; i++) {
      const y = PT + (cH / 4) * i;
      grid += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="var(--divider-color,#e0e0e0)" stroke-width="0.5"/>`;
    }

    let lines = '', yLabels = '';
    const toggleData = {};
    let yIdx = 0;

    for (const key of measMetrics) {
      const data = this._dayHistory[key] || [];
      const active = data.filter(d => d.value > 0);
      toggleData[key] = active.length > 0
        ? active.reduce((s, d) => s + d.value, 0) / active.length : 0;

      if (!this._visibleLines.has(key) || active.length === 0) continue;
      const max = Math.max(...active.map(d => d.value));
      if (max <= 0) continue;

      const color = LINE_COLORS[key] || '#999';
      const unit = this._units[key] || '';
      const maxStr = formatValue(max, key, unit);
      yLabels += `<text x="${PL - 4}" y="${PT + 5 + yIdx * 13}" text-anchor="end" fill="${color}" font-size="9" font-weight="500">${maxStr} ${unit}</text>`;
      yIdx++;

      const segments = this._splitIntoSessions(data);
      for (const seg of segments) {
        const points = seg.map(d => {
          const x = PL + ((d.time.getTime() - minTime) / range) * cW;
          const y = PT + cH - (d.value / max) * cH * 0.9;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        if (points.length > 1) {
          lines += `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        } else if (points.length === 1) {
          const [px, py] = points[0].split(',');
          lines += `<circle cx="${px}" cy="${py}" r="3" fill="${color}"/>`;
        }
      }
    }
    yLabels += `<text x="${PL - 4}" y="${PT + cH + 4}" text-anchor="end" fill="var(--secondary-text-color)" font-size="9">0</text>`;

    const fmt = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    let xLabels = '';
    xLabels += `<text x="${PL}" y="${H - 5}" text-anchor="start" fill="var(--secondary-text-color)" font-size="10">${fmt(new Date(rawMin))}</text>`;
    xLabels += `<text x="${W - PR}" y="${H - 5}" text-anchor="end" fill="var(--secondary-text-color)" font-size="10">${fmt(new Date(rawMax))}</text>`;

    const durationMin = (rawMax - rawMin) / 60000;
    if (durationMin > 3) {
      let intervalMin;
      if (durationMin < 10) intervalMin = 2;
      else if (durationMin < 30) intervalMin = 5;
      else if (durationMin < 60) intervalMin = 10;
      else intervalMin = 15;
      const intervalMs = intervalMin * 60000;
      const first = Math.ceil(rawMin / intervalMs) * intervalMs;
      for (let t = first; t <= rawMax; t += intervalMs) {
        const x = PL + ((t - minTime) / range) * cW;
        if (x < PL + 30 || x > W - PR - 30) continue;
        xLabels += `<text x="${x.toFixed(1)}" y="${H - 5}" text-anchor="middle" fill="var(--secondary-text-color)" font-size="10">${fmt(new Date(t))}</text>`;
      }
    }

    const toggles = measMetrics.map(key => {
      const active = this._visibleLines.has(key);
      const avg = toggleData[key] || 0;
      const unit = this._units[key] || '';
      const color = LINE_COLORS[key] || '#999';
      const valStr = avg > 0 ? ` ${formatValue(avg, key, unit)} ${unit}` : '';
      return `<button class="line-toggle${active ? ' active' : ''}" data-line="${key}" style="--line-color:${color}"><span class="line-swatch"></span>${ENTITY_META[key].label}${valStr}</button>`;
    }).join('');

    return `
      <div class="chart-section">
        <div class="section-title">Session</div>
        <div class="line-toggles">${toggles}</div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="chart-svg" role="img" aria-label="Session chart">
          ${grid}${yLabels}${lines}${xLabels}
        </svg>
      </div>`;
  }

  _renderGoals(sessions) {
    const goals = this._config.weekly_goals;
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
        this._drillFrom = null;
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
    this.shadowRoot.querySelectorAll('.chart-bar-hit').forEach((b) =>
      b.addEventListener('click', () => {
        this._drillToDay(parseInt(b.dataset.barIndex));
      }),
    );
    this.shadowRoot.querySelectorAll('.line-toggle').forEach((b) =>
      b.addEventListener('click', () => {
        const key = b.dataset.line;
        if (this._visibleLines.has(key)) {
          this._visibleLines.delete(key);
        } else {
          this._visibleLines.add(key);
        }
        this._render();
      }),
    );
    const backBtn = this.shadowRoot.querySelector('.back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this._drillBack());
    }
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
      .chart-bar-hit { cursor: pointer; opacity: 0; }
      .chart-bar-hit:hover { opacity: 0.08; fill: var(--primary-text-color); }

      .line-toggles { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
      .line-toggle {
        background: none; border: 1px solid var(--divider-color,#e0e0e0);
        border-radius: 12px; padding: 2px 10px; font-size: 0.72em;
        cursor: pointer; color: var(--disabled-text-color,#999);
        font-family: inherit; display: flex; align-items: center; gap: 4px;
        transition: border-color 0.2s, color 0.2s;
      }
      .line-toggle.active {
        border-color: var(--line-color);
        color: var(--primary-text-color);
      }
      .line-swatch {
        display: inline-block; width: 14px; height: 3px;
        background: var(--line-color); border-radius: 2px;
      }

      .back-btn {
        background: none; border: none; color: var(--primary-color);
        font-size: 0.82em; cursor: pointer; padding: 2px 8px;
        font-family: inherit; border-radius: 4px; margin-right: 4px;
      }
      .back-btn:hover { background: var(--secondary-background-color,rgba(0,0,0,0.05)); }

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

console.info(`%c FITNESS-STATS-CARD %c v${VERSION} `, 'background:#3498db;color:#fff;font-weight:bold', 'background:#555;color:#fff');

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'fitness-stats-card',
  name: 'Fitness Stats Card',
  description: 'Training statistics with period navigation for fitness machines',
  version: VERSION,
});
