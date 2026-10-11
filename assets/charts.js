/* 花满天下仪表盘 - 图表 */
(function() {
  var css = getComputedStyle(document.documentElement);
  var accent = css.getPropertyValue('--accent').trim();
  var accent2 = css.getPropertyValue('--accent2').trim();
  var ink = css.getPropertyValue('--ink').trim();
  var muted = css.getPropertyValue('--muted').trim();
  var rule = css.getPropertyValue('--rule').trim();
  var success = css.getPropertyValue('--success').trim();
  var danger = css.getPropertyValue('--danger').trim();

  var D = window.DASHBOARD_DATA;

  function yi(n) {
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + '亿';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(0) + '万';
    return (n || 0).toLocaleString();
  }

  var baseGrid = { left: 60, right: 24, top: 40, bottom: 40 };
  var baseAxisLabel = { color: muted, fontSize: 11 };
  var baseSplit = { lineStyle: { color: rule } };

  var charts = [];
  function track(c) { charts.push(c); return c; }

  /* ---------- 联盟：周功勋增量对比 ---------- */
  var c1 = track(echarts.init(document.getElementById('chart-week-merit'), null, { renderer: 'svg' }));
  c1.setOption({
    animation: false,
    tooltip: { trigger: 'axis', appendToBody: true, axisPointer: { type: 'shadow' },
      formatter: function(p) {
        var w = D.weekly[p[0].dataIndex];
        return w.days + '<br/>功勋增量: <b>' + yi(w.meritGain) + '</b>';
      }
    },
    grid: baseGrid,
    xAxis: { type: 'category', data: D.weekly.map(function(w) { return w.days; }), axisLabel: baseAxisLabel },
    yAxis: { type: 'value', axisLabel: { color: muted, formatter: function(v) { return yi(v); } }, splitLine: baseSplit },
    series: [{
      type: 'bar',
      barWidth: '46%',
      data: D.weekly.map(function(w, i) {
        return {
          value: w.meritGain,
          itemStyle: {
            color: i === D.weekly.length - 1
              ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: accent }, { offset: 1, color: accent2 }])
              : '#c7d6ea',
            borderRadius: [6, 6, 0, 0]
          }
        };
      }),
      label: { show: true, position: 'top', formatter: function(p) { return yi(p.value); }, color: ink, fontWeight: 700 }
    }]
  });

  /* ---------- 联盟：周末战力/实力趋势 ---------- */
  var c2 = track(echarts.init(document.getElementById('chart-week-power'), null, { renderer: 'svg' }));
  c2.setOption({
    animation: false,
    tooltip: { trigger: 'axis', appendToBody: true,
      formatter: function(ps) {
        var s = D.weekly[ps[0].dataIndex].days;
        ps.forEach(function(p) { s += '<br/>' + p.marker + p.seriesName + ': ' + yi(p.value); });
        return s;
      }
    },
    legend: { data: ['战力合计', '实力合计'], top: 0, textStyle: { color: muted } },
    grid: { left: 60, right: 24, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: D.weekly.map(function(w) { return w.days; }), axisLabel: baseAxisLabel },
    yAxis: { type: 'value', axisLabel: { color: muted, formatter: function(v) { return yi(v); } }, splitLine: baseSplit },
    series: [
      { name: '战力合计', type: 'line', smooth: true, symbolSize: 9, lineStyle: { width: 3, color: danger }, itemStyle: { color: danger },
        data: D.weekly.map(function(w) { return w.power; }),
        label: { show: true, formatter: function(p) { return yi(p.value); }, color: danger, fontSize: 10, position: 'top' } },
      { name: '实力合计', type: 'line', smooth: true, symbolSize: 9, lineStyle: { width: 3, color: accent }, itemStyle: { color: accent },
        data: D.weekly.map(function(w) { return w.strength; }) }
    ]
  });

  /* ---------- 联盟：每日功勋增量 ---------- */
  var battleDates = {};
  D.activities.forEach(function(a) {
    if (a.type === 'major') battleDates[a.date] = a.name;
  });
  var c3 = track(echarts.init(document.getElementById('chart-daily-merit'), null, { renderer: 'svg' }));
  c3.setOption({
    animation: false,
    tooltip: { trigger: 'axis', appendToBody: true, axisPointer: { type: 'shadow' },
      formatter: function(ps) {
        var p = ps[0];
        var day = D.daily[p.dataIndex];
        var s = day.full + '<br/>功勋增量: <b>' + yi(day.meritGain) + '</b><br/>快照人数: ' + day.members;
        var act = D.activities.filter(function(a) { return a.date === day.full; });
        act.forEach(function(a) { s += '<br/>' + (a.type === 'major' ? '🔴 ' : '⚔️ ') + a.name; });
        return s;
      }
    },
    grid: { left: 60, right: 24, top: 30, bottom: 50 },
    xAxis: { type: 'category', data: D.daily.map(function(d) { return d.d; }), axisLabel: { color: muted, rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: muted, formatter: function(v) { return yi(v); } }, splitLine: baseSplit },
    series: [{
      type: 'bar',
      data: D.daily.map(function(d) {
        var isMajor = !!battleDates[d.full];
        return {
          value: d.meritGain,
          itemStyle: {
            color: isMajor ? danger : (d.meritGain > 8e8 ? accent : accent2),
            borderRadius: [3, 3, 0, 0],
            opacity: d.meritGain === 0 ? 0.25 : 1
          }
        };
      })
    }, {
      type: 'line',
      smooth: true,
      symbol: 'none',
      lineStyle: { color: success, width: 2, type: 'dashed' },
      data: D.daily.map(function(d) { return d.meritGain; }),
      z: 5
    }]
  });

  /* ---------- 成员图表（动态） ---------- */
  var memberMeritChart = null;
  var memberPowerChart = null;

  window.renderMemberCharts = function(member) {
    var days = (member.trend || []).map(function(x) { return x ? x.d : null; });
    var gains = (member.trend || []).map(function(x) { return x ? x.meritGain : null; });
    var totals = (member.trend || []).map(function(x) { return x ? x.totalMerit : null; });
    var powers = (member.trend || []).map(function(x) { return x ? x.power : null; });
    var strengths = (member.trend || []).map(function(x) { return x ? x.strength : null; });

    if (!memberMeritChart) memberMeritChart = track(echarts.init(document.getElementById('chart-m-merit'), null, { renderer: 'svg' }));
    memberMeritChart.setOption({
      animation: false,
      tooltip: { trigger: 'axis', appendToBody: true,
        formatter: function(ps) {
          var s = ps[0].axisValue;
          ps.forEach(function(p) {
            if (p.value == null) return;
            s += '<br/>' + p.marker + p.seriesName + ': ' + yi(p.value);
          });
          return s;
        }
      },
      legend: { data: ['当日功勋增量', '总功勋'], top: 0, textStyle: { color: muted } },
      grid: { left: 64, right: 64, top: 40, bottom: 36 },
      xAxis: { type: 'category', data: days, axisLabel: baseAxisLabel },
      yAxis: [
        { type: 'value', name: '当日增量', nameTextStyle: { color: muted }, axisLabel: { color: muted, formatter: function(v) { return yi(v); } }, splitLine: baseSplit },
        { type: 'value', name: '总功勋', nameTextStyle: { color: muted }, axisLabel: { color: muted, formatter: function(v) { return yi(v); } }, splitLine: { show: false } }
      ],
      series: [
        { name: '当日功勋增量', type: 'bar', barWidth: '42%', yAxisIndex: 0, data: gains,
          itemStyle: {
            color: function(p) { return p.value > 0 ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: accent2 }, { offset: 1, color: accent }]) : '#e2e8f0'; },
            borderRadius: [4, 4, 0, 0]
          },
          label: { show: true, position: 'top', formatter: function(p) { return p.value > 0 ? yi(p.value) : ''; }, color: muted, fontSize: 9 }
        },
        { name: '总功勋', type: 'line', smooth: true, yAxisIndex: 1, symbolSize: 7, data: totals,
          lineStyle: { width: 3, color: '#f59e0b' }, itemStyle: { color: '#f59e0b' } }
      ]
    }, true);

    if (!memberPowerChart) memberPowerChart = track(echarts.init(document.getElementById('chart-m-power'), null, { renderer: 'svg' }));
    memberPowerChart.setOption({
      animation: false,
      tooltip: { trigger: 'axis', appendToBody: true,
        formatter: function(ps) {
          var s = ps[0].axisValue;
          ps.forEach(function(p) {
            if (p.value == null) return;
            s += '<br/>' + p.marker + p.seriesName + ': ' + yi(p.value);
          });
          return s;
        }
      },
      legend: { data: ['战力', '实力'], top: 0, textStyle: { color: muted } },
      grid: { left: 64, right: 24, top: 40, bottom: 36 },
      xAxis: { type: 'category', data: days, axisLabel: baseAxisLabel },
      yAxis: { type: 'value', axisLabel: { color: muted, formatter: function(v) { return yi(v); } }, splitLine: baseSplit },
      series: [
        { name: '战力', type: 'line', smooth: true, symbolSize: 7, data: powers, areaStyle: { opacity: 0.08 },
          lineStyle: { width: 3, color: danger }, itemStyle: { color: danger } },
        { name: '实力', type: 'line', smooth: true, symbolSize: 7, data: strengths,
          lineStyle: { width: 3, color: accent }, itemStyle: { color: accent } }
      ]
    }, true);
  };

  window.addEventListener('resize', function() {
    charts.forEach(function(c) { c.resize(); });
  });
})();
