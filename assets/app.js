/* 花满天下仪表盘 - 交互逻辑 */
(function() {
  var D = window.DASHBOARD_DATA;
  var members = D.members;
  var TOTAL = members.length;

  function yi(n) {
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(0) + '万';
    return (n || 0).toLocaleString();
  }
  function full(n) { return (n || 0).toLocaleString(); }
  function pct(cur, prev) {
    if (!prev) return null;
    return (cur - prev) / Math.abs(prev) * 100;
  }
  function deltaHtml(cur, prev, opts) {
    opts = opts || {};
    if (prev === undefined || prev === null) return '<span class="delta flat">—</span>';
    var d = cur - prev;
    if (d === 0) return '<span class="delta flat">持平</span>';
    var up = d > 0;
    var cls = up ? 'up' : 'down';
    var arrow = up ? '↑' : '↓';
    var p = pct(cur, prev);
    var txt;
    if (opts.forceYi) txt = arrow + yi(Math.abs(d));
    else if (p !== null && Math.abs(p) < 1000) txt = arrow + Math.abs(p).toFixed(1) + '%';
    else txt = arrow + yi(Math.abs(d));
    return '<span class="delta ' + cls + '">' + txt + '</span>';
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function() { t.classList.remove('show'); }, 2600);
  }

  /* ================= Tab 切换 ================= */
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-pane').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      setTimeout(function() { window.dispatchEvent(new Event('resize')); }, 60);
    });
  });

  /* ================= 模块一：联盟周对比 ================= */
  function renderWeeks() {
    var cards = D.weekly.map(function(w, i) {
      var prev = i > 0 ? D.weekly[i - 1] : null;
      var isLatest = i === D.weekly.length - 1;
      return `
        <div class="week-card ${isLatest ? 'latest' : ''}">
          <div class="week-head">
            <span>第 ${i + 1} 周 · ${w.days}</span>
            ${isLatest ? '<span class="tag">本周</span>' : '<span class="tag">' + w.snapshotDays + '天快照</span>'}
          </div>
          <div class="week-body">
            <div class="week-metric">
              <span class="wm-label">在册成员</span>
              <span class="wm-value">${w.members} 人 ${prev ? deltaHtml(w.members, prev.members) : '<span class="delta flat">—</span>'}</span>
            </div>
            <div class="week-metric">
              <span class="wm-label">功勋增量</span>
              <span class="wm-value">${yi(w.meritGain)} ${prev ? deltaHtml(w.meritGain, prev.meritGain) : '<span class="delta flat">—</span>'}</span>
            </div>
            <div class="week-metric">
              <span class="wm-label">周末战力</span>
              <span class="wm-value">${yi(w.power)} ${prev ? deltaHtml(w.power, prev.power) : '<span class="delta flat">—</span>'}</span>
            </div>
            <div class="week-metric">
              <span class="wm-label">周内战力变化</span>
              <span class="wm-value">${w.powerChange >= 0 ? '+' : ''}${yi(w.powerChange)}</span>
            </div>
            <div class="week-metric">
              <span class="wm-label">周末实力</span>
              <span class="wm-value">${yi(w.strength)} ${prev ? deltaHtml(w.strength, prev.strength) : '<span class="delta flat">—</span>'}</span>
            </div>
            <div class="week-metric">
              <span class="wm-label">周捐献峰值</span>
              <span class="wm-value">${full(w.weekDonate)}</span>
            </div>
          </div>
        </div>`;
    });
    // 由近到远：最新一周排最前
    document.getElementById('weekGrid').innerHTML = cards.reverse().join('');
  }

  function renderActivities() {
    document.getElementById('activityTableBody').innerHTML = D.activities.map(function(a) {
      var avg = a.participants ? Math.round(a.totalMerit / a.participants) : 0;
      return `
        <tr>
          <td class="mono">${a.date}</td>
          <td><span class="activity-name ${a.type === 'major' ? 'major' : ''}">${a.name}</span></td>
          <td class="num">${a.participants}</td>
          <td class="num mono" title="${full(a.totalMerit)}">${yi(a.totalMerit)}</td>
          <td class="num mono">${yi(avg)}</td>
          <td class="note-cell">${a.note}</td>
        </tr>`;
    }).join('');
  }

  /* ================= 模块二：成员查询 ================= */
  var byName = {}, byId = {};
  members.forEach(function(m) { byName[m.name] = m; byId[m.id.toUpperCase()] = m; });

  function lastDay(m) {
    var days = m.trend || [];
    for (var i = days.length - 1; i >= 0; i--) { if (days[i]) return days[i]; }
    return null;
  }
  function firstDay(m) {
    var days = m.trend || [];
    for (var i = 0; i < days.length; i++) { if (days[i]) return days[i]; }
    return null;
  }

  /* ---- 联盟级参考值（评价用） ---- */
  var donateSorted = members.map(function(m) {
    var ld = lastDay(m);
    return ld ? ld.weekDonate : 0;
  }).sort(function(a, b) { return a - b; });
  var medianDonate = donateSorted[Math.floor(donateSorted.length / 2)] || 0;
  var lastAll = D.daily[D.daily.length - 1];
  var baseAll = D.daily.length >= 8 ? D.daily[D.daily.length - 8] : D.daily[0];
  var avgGain7 = lastAll && baseAll ? (lastAll.totalMerit - baseAll.totalMerit) / Math.max(1, lastAll.members) : 0;

  function buildEval(m) {
    var r = m.rank || {};
    var ld = lastDay(m), fd = firstDay(m);
    var gain7 = ld && fd ? ld.totalMerit - fd.totalMerit : 0;
    var tr = r.totalMerit || TOTAL;
    var lvl = tr <= 5 ? '联盟顶级输出，核心主力'
      : tr <= 20 ? '稳居上游，输出贡献可观'
      : tr <= Math.ceil(TOTAL * 0.6) ? '处于中游，贡献稳定'
      : '排名靠后，仍有上升空间';
    var speed = gain7 <= 0 ? '近7天功勋几乎无增长，处于休整或挂机状态'
      : gain7 >= avgGain7 * 2 ? '功勋增速远超联盟平均，输出效率突出'
      : gain7 >= avgGain7 * 0.5 ? '功勋增速与联盟整体节奏持平'
      : '功勋增速低于联盟平均';
    var pchg = ld && fd ? ld.power - fd.power : 0;
    var pw = pchg > 0 ? '战力稳步提升（+' + yi(pchg) + '）'
      : pchg < 0 ? '战力下降 ' + yi(Math.abs(pchg)) + '，可能经历了高强度战斗损耗'
      : '战力保持平稳';
    var donate = ld ? ld.weekDonate : 0;
    var dnt = donate > medianDonate ? '周捐献 ' + full(donate) + '，高于联盟中位数（' + full(medianDonate) + '），建设参与度高'
      : donate > 0 ? '周捐献 ' + full(donate) + '，低于联盟中位数（' + full(medianDonate) + '），可鼓励参与联盟建设'
      : '本周暂无捐献记录';
    var actLine = '累计参加活动 ' + m.activityCount + ' 次' + (m.lastActivity ? '，最近 ' + m.lastActivity : '') +
      (m.active === '是' ? '；本周已出勤' : '；本周未出勤，需关注');
    var tags = [];
    if (/新成员/.test(m.note || '')) tags.push('新成员');
    if (m.activityCount >= 6) tags.push('全勤型');
    if ((r.weekMerit || 99) <= 10) tags.push('本周输出主力');
    if ((r.weekDonate || 99) <= 10) tags.push('捐献模范');
    if (gain7 <= 0) tags.push('休整中');
    if (m.note && /未参加|缺席|请假/.test(m.note)) tags.push('需跟进');
    return '<div class="eval-title">🧭 基本评价与特点分析</div>' +
      '<ul>' +
      '<li>🏅 <span>功勋水平：赛季总功勋 <b>' + yi(m.seasonMerit) + '</b>，联盟第 ' + tr + ' 名 —— ' + lvl + '。</span></li>' +
      '<li>📈 <span>增长态势：近7天 +' + yi(gain7) + '（日均 ' + yi(gain7 / 7) + '），' + speed + '。</span></li>' +
      '<li>🛡️ <span>战力状态：' + pw + '。</span></li>' +
      '<li>📅 <span>出勤活跃：' + actLine + '。</span></li>' +
      '<li>🤝 <span>捐献贡献：' + dnt + '。</span></li>' +
      '</ul>' +
      (tags.length ? '<div class="eval-tags">' + tags.map(function(t) { return '<span class="eval-tag">#' + t + '</span>'; }).join('') + '</div>' : '');
  }

  function renderMember(m) {
    currentMember = m;
    document.getElementById('memberDetail').style.display = 'block';
    document.getElementById('mName').textContent = m.name;
    document.getElementById('mId').textContent = m.id;

    // 标签
    var classMap = { 5: ['gold', '阶级 5'], 4: ['blue', '阶级 4'], 3: ['green', '阶级 3'], 2: ['gray', '阶级 2'] };
    var tags = [];
    if (classMap[m.class]) tags.push('<span class="mp-tag ' + classMap[m.class][0] + '">' + classMap[m.class][1] + '</span>');
    if (m.furnace) tags.push('<span class="mp-tag">' + m.furnace + '</span>');
    tags.push('<span class="mp-tag ' + (m.active === '是' ? 'green' : 'gray') + '">本周' + (m.active === '是' ? '已参加' : '未参加') + '</span>');
    if (/新成员/.test(m.note)) tags.push('<span class="mp-tag gold">新成员</span>');
    document.getElementById('mTags').innerHTML = tags.join('');

    // 元信息
    var ld = lastDay(m), fd = firstDay(m);
    var gain7 = ld && fd ? ld.totalMerit - fd.totalMerit : 0;
    var meta = `年度累计功勋 <b>${yi(m.annualMerit)}</b> · 本赛季功勋 <b>${yi(m.seasonMerit)}</b> ·
      参加活动 <b>${m.activityCount}</b> 次 · 记录天数 ${m.days} 天
      ${m.firstActivity ? '· 首次活动 ' + m.firstActivity : ''} ${m.lastActivity ? '· 最近活动 ' + m.lastActivity : ''}
      · 近7天功勋增长 <b style="color:var(--success)">+${yi(gain7)}</b>`;
    document.getElementById('mMeta').innerHTML = meta;

    var noteEl = document.getElementById('mNote');
    if (m.note && !/^✅/.test(m.note) && m.note !== '新成员') {
      noteEl.style.display = 'block';
      noteEl.textContent = '📌 ' + m.note;
    } else {
      noteEl.style.display = 'none';
    }

    // 评价与特点
    document.getElementById('mEval').innerHTML = buildEval(m);

    // 排名卡片
    var r = m.rank || {};
    function rc(label, rank, value) {
      var top3 = rank && rank <= 3;
      return `
        <div class="rank-card ${top3 ? 'top3' : ''}">
          <div class="rc-label">${label}</div>
          <div class="rc-rank">${rank ? '第 ' + rank : '—'}<span class="total"> / ${TOTAL}</span></div>
          <div class="rc-value">${value}</div>
        </div>`;
    }
    document.getElementById('rankGrid').innerHTML =
      rc('总功勋排名', r.totalMerit, yi(m.seasonMerit)) +
      rc('本周功勋排名', r.weekMerit, yi(m.weeklyMerit)) +
      rc('战力排名', r.power, yi(m.power)) +
      rc('实力排名', r.strength, ld ? yi(ld.strength) : '—') +
      rc('周捐献排名', r.weekDonate, ld ? full(ld.weekDonate) : '—');

    // 7天明细表
    document.getElementById('trendTableBody').innerHTML = (m.trend || []).map(function(x) {
      if (!x) return '<tr><td colspan="7" class="center" style="color:var(--muted)">当日无快照</td></tr>';
      var mc = x.meritGain > 0 ? 'pos' : (x.meritGain < 0 ? 'neg' : '');
      var pc = x.powerChange > 0 ? 'pos' : (x.powerChange < 0 ? 'neg' : '');
      return `
        <tr>
          <td class="mono">${x.d}</td>
          <td class="num">${yi(x.totalMerit)}</td>
          <td class="num ${mc}">${x.meritGain >= 0 ? '+' : ''}${yi(x.meritGain)}</td>
          <td class="num">${yi(x.power)}</td>
          <td class="num ${pc}">${x.powerChange >= 0 ? '+' : ''}${yi(x.powerChange)}</td>
          <td class="num">${yi(x.strength)}</td>
          <td class="num">${full(x.weekDonate)}</td>
        </tr>`;
    }).join('');

    // 底部每日数据表（跟随选中成员）
    renderDailyTable();

    // 图表（容器显示后再渲染）
    requestAnimationFrame(function() {
      window.renderMemberCharts(m);
      setTimeout(function() { window.dispatchEvent(new Event('resize')); }, 30);
    });
  }

  /* ---- 自定义成员下拉（按阶级降序、战力降序） ---- */
  var memberInput = document.getElementById('memberInput');
  var memberDropdown = document.getElementById('memberDropdown');
  var ddItems = [], ddIdx = -1;
  var pickerSorted = members.slice().sort(function(a, b) {
    return (b.class - a.class) || (b.power - a.power);
  });

  function renderDropdown(kw) {
    kw = (kw || '').trim().toLowerCase();
    var list = pickerSorted.filter(function(x) {
      return !kw || x.name.toLowerCase().indexOf(kw) >= 0 || x.id.toLowerCase().indexOf(kw) >= 0;
    });
    ddItems = list;
    ddIdx = -1;
    if (!list.length) {
      memberDropdown.innerHTML = '<div class="member-empty">未找到匹配成员</div>';
    } else {
      memberDropdown.innerHTML = ddItems.map(function(m, i) {
        return '<div class="member-option" data-i="' + i + '"><span class="mname">' + m.name +
          '</span><span class="oid">' + m.id + ' · 阶级' + m.class + ' · 功勋' + yi(m.annualMerit) + '</span></div>';
      }).join('');
    }
    memberDropdown.style.display = 'block';
  }
  function hideDropdown() { memberDropdown.style.display = 'none'; ddIdx = -1; }
  function chooseMember(m) {
    memberInput.value = m.id + ' ' + m.name;
    hideDropdown();
    renderMember(m);
    document.getElementById('memberDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // 聚焦/点击都弹出完整列表并全选文字：换成员时直接打字覆盖，无需先删除
  function openPicker() {
    memberInput.select();
    renderDropdown('');
  }
  memberInput.addEventListener('focus', openPicker);
  memberInput.addEventListener('click', openPicker);
  memberInput.addEventListener('input', function() { renderDropdown(this.value); });
  memberInput.addEventListener('keydown', function(e) {
    var opts = memberDropdown.querySelectorAll('.member-option');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!opts.length) return;
      ddIdx = e.key === 'ArrowDown' ? (ddIdx + 1) % opts.length : (ddIdx <= 0 ? opts.length - 1 : ddIdx - 1);
      opts.forEach(function(o, i) { o.classList.toggle('active', i === ddIdx); });
      opts[ddIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (ddIdx >= 0 && ddItems[ddIdx]) chooseMember(ddItems[ddIdx]);
      else if (ddItems.length) chooseMember(ddItems[0]);
      else toast('未找到匹配成员，试试输入 ID 或昵称关键词');
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });
  memberDropdown.addEventListener('mousedown', function(e) {
    var opt = e.target.closest('.member-option');
    if (opt) { e.preventDefault(); chooseMember(ddItems[+opt.dataset.i]); }
  });
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.member-select-wrap')) hideDropdown();
  });

  /* ================= 成员每日功勋数据（日期范围） ================= */
  var currentMember = null;
  var lastDailyRows = [];

  var rangeStartSel = document.getElementById('rangeStart');
  var rangeEndSel = document.getElementById('rangeEnd');
  D.daily.forEach(function(d) {
    rangeStartSel.add(new Option(d.full, d.full));
    rangeEndSel.add(new Option(d.full, d.full));
  });
  rangeStartSel.value = D.daily[0].full;
  rangeEndSel.value = D.daily[D.daily.length - 1].full;

  function dateToIdx(fv) {
    for (var i = 0; i < D.daily.length; i++) { if (D.daily[i].full === fv) return i; }
    return -1;
  }

  function renderDailyTable() {
    var m = currentMember;
    if (!m) return;
    var si = dateToIdx(rangeStartSel.value), ei = dateToIdx(rangeEndSel.value);
    if (si < 0 || ei < 0) return;
    if (si > ei) { rangeEndSel.value = rangeStartSel.value; ei = si; }
    var pts = (D.meritSeries && D.meritSeries[m.id]) || [];
    var rows = [], prev = null;
    for (var k = 0; k < pts.length; k++) {
      var di = pts[k][0];
      if (di < si) prev = pts[k];
      else if (di <= ei) rows.push(pts[k]);
    }
    document.getElementById('rangeHint').textContent =
      '当前成员：' + m.id + ' ' + m.name + ' · ' + rangeStartSel.value + ' ~ ' + rangeEndSel.value +
      ' · 范围内 ' + rows.length + ' 天快照（首日增量对应该日前最近一个快照日）';
    lastDailyRows = [];
    var prevSnap = prev;
    var html = rows.map(function(p) {
      var gain = prevSnap ? p[1] - prevSnap[1] : 0;
      var pchg = prevSnap ? p[2] - prevSnap[2] : 0;
      var dateStr = D.daily[p[0]].full;
      lastDailyRows.push([dateStr, p[1], gain, p[2], pchg, p[3], p[4], p[5]]);
      var mc = gain > 0 ? 'pos' : (gain < 0 ? 'neg' : '');
      var pc = pchg > 0 ? 'pos' : (pchg < 0 ? 'neg' : '');
      prevSnap = p;
      return '<tr>' +
        '<td class="mono">' + dateStr + '</td>' +
        '<td class="num" title="' + full(p[1]) + '">' + yi(p[1]) + '</td>' +
        '<td class="num ' + mc + '" title="' + (gain >= 0 ? '+' : '') + full(gain) + '">' + (gain >= 0 ? '+' : '') + yi(gain) + '</td>' +
        '<td class="num" title="' + full(p[2]) + '">' + yi(p[2]) + '</td>' +
        '<td class="num ' + pc + '" title="' + (pchg >= 0 ? '+' : '') + full(pchg) + '">' + (pchg >= 0 ? '+' : '') + yi(pchg) + '</td>' +
        '<td class="num" title="' + full(p[3]) + '">' + yi(p[3]) + '</td>' +
        '<td class="num" title="' + full(p[4]) + '">' + yi(p[4]) + '</td>' +
        '<td class="num">' + full(p[5]) + '</td>' +
        '</tr>';
    }).join('');
    document.getElementById('fullTableBody').innerHTML =
      html || '<tr><td colspan="8" class="center" style="color:var(--muted)">该成员在此日期范围内无快照记录</td></tr>';
  }

  function copyText(text, okMsg) {
    function manualFallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      if (ok) { toast(okMsg); return; }
      // 剪贴板完全被拦截时：弹出数据层供手动 Ctrl/⌘+C 复制
      var mt = document.getElementById('copyModalText');
      mt.value = text;
      document.getElementById('copyModal').style.display = 'flex';
      mt.focus();
      mt.select();
      toast('请按 Ctrl/⌘+C 复制弹层中的数据');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() { toast(okMsg); }, manualFallback);
    } else manualFallback();
  }
  document.getElementById('copyModalClose').addEventListener('click', function() {
    document.getElementById('copyModal').style.display = 'none';
  });
  document.getElementById('copyModal').addEventListener('click', function(e) {
    if (e.target === this) this.style.display = 'none';
  });

  document.getElementById('copyListBtn').addEventListener('click', function() {
    if (!lastDailyRows.length) { toast('当前成员在此日期范围内无数据'); return; }
    var rows = [['日期', '总功勋', '当日功勋增量', '战力', '战力变化', '实力', '周功勋', '周捐献']].concat(lastDailyRows);
    copyText(rows.map(function(r) { return r.join('\t'); }).join('\n'),
      '已复制 ' + lastDailyRows.length + ' 行数据（Tab 分隔），可直接粘贴到 Excel');
  });

  rangeStartSel.addEventListener('change', renderDailyTable);
  rangeEndSel.addEventListener('change', renderDailyTable);

  /* ================= 初始化 ================= */
  document.getElementById('asOfDate').textContent = D.asOf;
  document.getElementById('memberCount').textContent = TOTAL;
  document.getElementById('rankTotal').textContent = TOTAL;
  document.getElementById('dailyDays').textContent = D.daily.length;
  document.getElementById('trendHint').textContent = D.trendDates[0] + '–' + D.trendDates[D.trendDates.length - 1];
  renderWeeks();
  renderActivities();
  // 默认展示功勋第一名
  if (members.length) {
    var top = members[0];
    memberInput.value = top.id + ' ' + top.name;
    renderMember(top);
  }
})();
