# 花满天下仪表盘：拉取飞书最新数据并重建 data.js + 单文件版
# 由 update.sh 定时调用。
#   取数通道二选一（自动判定）：
#     1) 飞书开放平台 API —— 需要 ~/.hermes/.env 里有 FEISHU_APP_ID / FEISHU_APP_SECRET，
#        且该应用已加入表格（J4125 上的定时任务走这条）。
#     2) lark-cli（TRAE 插件自带）—— Mac 上开发时走这条，需已 `lark-cli auth login`。
#   表格 token 不落在仓库里：读 $HUAMAN_SPREADSHEET → scripts/.local.env → 内置常量。
import json, os, re, subprocess, sys, base64, pathlib, urllib.parse, urllib.request
from datetime import date, datetime, timedelta
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
TMP = pathlib.Path(os.environ.get('HUAMAN_TMP', '/tmp/huaman_fetch'))
TMP.mkdir(parents=True, exist_ok=True)

API_BASE = 'https://open.feishu.cn'
EPOCH = date(1899, 12, 30)
LEGACY_SHEET = 'NtKosgeLWh8naMtl73KcF2GwnSh'   # 仅表格标识（非密钥），读数据仍需应用凭据

# 页签名 → (sheet_id, 最少读取行数, 日期列, 预期列数)
# ⚠️ 读取行数由 metainfo 的 rowCount 动态决定（见 sheet_range），**不要再硬编码行数**：
#    2026-10-13 表行数突破 2000，写死 A1:K2000 时静默丢了当天最后 50 人（页面显示 49 人）。
SHEETS = {
    '成员数据': ('c7b925', 2000, [0], 11),
    '功勋累计': ('2FckUN', 2000, [7, 8], 14),
    '活动明细': ('3lbxIY', 2000, [0], 5),
}
GRID_FALLBACK = 20000   # metainfo 取不到时的兜底行数（宁大勿小）


def sheet_token():
    t = os.environ.get('HUAMAN_SPREADSHEET', '').strip()
    if t:
        return t
    local = ROOT / 'scripts' / '.local.env'
    if local.exists():
        for line in local.read_text(encoding='utf-8').splitlines():
            if line.strip().startswith('HUAMAN_SPREADSHEET='):
                return line.split('=', 1)[1].strip().strip('"\'')
    return LEGACY_SHEET


_grid_cache = {}          # sheet_id → rowCount
_grid_fallback = set()    # metainfo 取不到、走了兜底行数的 sheet_id


def grid_rowcount(sid):
    """页签网格行数（= 表能装的最大行数）。表写入超界时飞书会自动扩网格，所以它 ≥ 数据末行。"""
    if sid in _grid_cache:
        return _grid_cache[sid]
    n = GRID_FALLBACK
    try:
        url = '%s/open-apis/sheets/v2/spreadsheets/%s/metainfo' % (API_BASE, sheet_token())
        req = urllib.request.Request(url)
        req.add_header('Authorization', 'Bearer ' + tenant_token())
        d = json.loads(urllib.request.urlopen(req, timeout=30).read())
        for s in (d.get('data') or {}).get('sheets') or []:
            if s.get('sheetId') == sid and s.get('rowCount'):
                n = int(s['rowCount'])
    except Exception as e:  # 拿不到就用兜底行数，宁大勿小
        _grid_fallback.add(sid)
        print('（[%s] metainfo 读取失败，用兜底行数 %d：%s）' % (sid, n, e), file=sys.stderr)
    _grid_cache[sid] = n
    return n


def sheet_range(sid, ncol, min_rows):
    last = max(int(min_rows), grid_rowcount(sid))
    return 'A1:%s%d' % (chr(ord('A') + ncol - 1), last)


def env_file():
    hh = os.environ.get('HERMES_HOME')
    p = os.path.join(hh, '.env') if hh else ''
    return p if p and os.path.exists(p) else os.path.expanduser('~/.hermes/.env')


def tenant_token():
    """有飞书应用凭据就返回 token，没有返回 None（Mac 上回退 lark-cli）。"""
    e = {}
    try:
        src = open(env_file(), encoding='utf-8', errors='ignore')
    except OSError:
        return None
    for line in src:
        if '=' in line and not line.strip().startswith('#'):
            k, v = line.strip().split('=', 1)
            e[k] = v.strip().strip('"').strip("'")
    if not e.get('FEISHU_APP_ID') or not e.get('FEISHU_APP_SECRET'):
        return None
    req = urllib.request.Request(
        API_BASE + '/open-apis/auth/v3/tenant_access_token/internal',
        data=json.dumps({'app_id': e['FEISHU_APP_ID'], 'app_secret': e['FEISHU_APP_SECRET']}).encode(),
        method='POST')
    req.add_header('Content-Type', 'application/json')
    return json.loads(urllib.request.urlopen(req, timeout=30).read())['tenant_access_token']


def fmt_date(v):
    if v is None or v == '':
        return ''
    if isinstance(v, (int, float)):
        return (EPOCH + timedelta(days=int(v))).strftime('%Y/%m/%d')
    s = str(v).strip()
    for sep in ('-', '/'):
        if sep in s and len(s.split(sep)[0]) == 4:
            y, m, d = (int(x) for x in s.replace('/', '-').split('-')[:3])
            return date(y, m, d).strftime('%Y/%m/%d')
    return s


def cell(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def quote(s):
    return '"' + s.replace('"', '""') + '"' if any(c in s for c in ',"\n') else s


def fetch_api(sheet):
    """飞书 API → 与 lark-cli 同构的 annotated_csv，下游 build 逻辑对两者一视同仁。"""
    sid, min_rows, date_cols, ncol = SHEETS[sheet]
    rng = sheet_range(sid, ncol, min_rows)
    url = '%s/open-apis/sheets/v2/spreadsheets/%s/values/%s?valueRenderOption=UnformattedValue' % (
        API_BASE, sheet_token(), urllib.parse.quote(sid + '!' + rng, safe=''))
    req = urllib.request.Request(url)
    req.add_header('Authorization', 'Bearer ' + tenant_token())
    d = json.loads(urllib.request.urlopen(req, timeout=60).read())
    if d.get('code') != 0:
        raise RuntimeError('读[%s]失败 code=%s msg=%s' % (sheet, d.get('code'), d.get('msg')))
    values = d['data']['valueRange']['values']
    lines = []
    for i, row in enumerate(values, 1):
        row = list(row)
        for c in date_cols:
            if c < len(row):
                row[c] = fmt_date(row[c])
        fields = [cell(v) for v in row]
        if not any(f != '' for f in fields):
            continue
        while len(fields) < ncol:      # 补齐空列：解析端靠 len(f) 判断整行是否完整
            fields.append('')
        lines.append('[row=%d]%s' % (i, ','.join(quote(f) for f in fields)))
    if len(lines) < 2:
        raise RuntimeError('[%s] 只读到表头 —— 表格结构变了或应用没有该表格权限' % sheet)
    # 截断自检：只有走兜底行数时才有被吞的风险（用 rowCount 时范围必然覆盖全表）
    if sid in _grid_fallback and values and any(str(v).strip() for v in values[-1]):
        print('⚠️ [%s] 数据顶到读取范围最后一行（%s），可能有行被吞掉，请检查 metainfo.rowCount'
              % (sheet, rng), file=sys.stderr)
    return '\n'.join(lines) + '\n'


def fetch_larkcli(sheet):
    out = TMP / ('%s.json' % sheet)
    r = subprocess.run(
        ['lark-cli', 'sheets', '+csv-get', '--spreadsheet-token', sheet_token(),
         '--sheet-name', sheet, '--output-path', str(out)],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError('lark-cli 拉取[%s]失败: %s' % (sheet, r.stderr.strip() or r.stdout.strip()))
    d = json.loads(out.read_text(encoding='utf-8'))
    csv = d.get('annotated_csv') or (d.get('data') or {}).get('annotated_csv')
    if not csv:
        raise RuntimeError('[%s] 返回中无 annotated_csv' % sheet)
    return csv


def fetch(sheet):
    if tenant_token():
        return fetch_api(sheet)
    try:
        return fetch_larkcli(sheet)
    except FileNotFoundError:
        raise RuntimeError('无飞书应用凭据（~/.hermes/.env 缺 FEISHU_APP_ID）且本机没有 lark-cli')


def parse_line(content):
    fields, cur, in_quote, i = [], '', False, 0
    while i < len(content):
        c = content[i]
        if c == '"':
            if in_quote and i + 1 < len(content) and content[i + 1] == '"':
                cur += '"'; i += 2; continue
            in_quote = not in_quote
        elif c == ',' and not in_quote:
            fields.append(cur); cur = ''
        else:
            cur += c
        i += 1
    fields.append(cur)
    return fields


def num(s):
    s = s.strip()
    try:
        return int(s) if s else 0
    except ValueError:
        return 0


def main():
    csv_daily = fetch('成员数据')
    csv_cum = fetch('功勋累计')
    csv_act = fetch('活动明细')

    # 1. 成员每日快照
    records = []
    for line in csv_daily.split('\n'):
        m = re.match(r'^\[row=(\d+)\]\s?(.*)$', line)
        if not m or int(m.group(1)) == 1:
            continue
        f = parse_line(m.group(2))
        if len(f) < 11 or not f[0].strip():
            continue
        records.append({
            'date': f[0].strip(), 'name': f[2].strip(),
            'class': num(f[3]), 'furnace': f[4].strip(),
            'power': num(f[5]), 'weekMerit': num(f[6]), 'totalMerit': num(f[7]),
            'weekDonate': num(f[8]), 'strength': num(f[9]), 'id': f[10].strip()
        })
    if not records:
        raise RuntimeError('成员数据为空')

    dates = sorted(set(r['date'] for r in records))
    date_idx = {d: i for i, d in enumerate(dates)}

    daily, prev_total = [], None
    for d in dates:
        rows = [r for r in records if r['date'] == d]
        tot = sum(r['totalMerit'] for r in rows)
        daily.append({
            'd': d[5:], 'full': d, 'members': len(rows),
            'power': sum(r['power'] for r in rows),
            'strength': sum(r['strength'] for r in rows),
            'totalMerit': tot,
            'meritGain': tot - prev_total if prev_total is not None else 0,
            'weekDonate': sum(r['weekDonate'] for r in rows)
        })
        prev_total = tot

    # 1b. 人数突变自检：最新一天比前一天少一大截 = 多半是取数/导入被截断（2026-10-13 事故：
    #     范围写死 A1:K2000，当天 99 人只读到前 49 人，页面显示「在册成员 49 人」）。
    if len(daily) >= 2:
        cur, prev = daily[-1]['members'], daily[-2]['members']
        if prev and cur <= prev * 0.8 and prev - cur >= 10:
            print('WARN 人数突降：%s %d 人 → %s %d 人（前一天 %d）。'
                  '先核对飞书表当天行数与 metainfo.rowCount，确认不是取数被截断。'
                  % (daily[-2]['full'], prev, daily[-1]['full'], cur, prev))

    def parse_date(s): return datetime.strptime(s, '%Y/%m/%d')
    def week_start(dt): return dt - timedelta(days=dt.weekday())

    weeks = defaultdict(list)
    for d in dates:
        weeks[week_start(parse_date(d)).strftime('%Y/%m/%d')].append(d)
    weekly = []
    for ws in sorted(weeks.keys()):
        wdates = sorted(weeks[ws], key=parse_date)
        first_d, last_d = wdates[0], wdates[-1]
        ft, lt = daily[date_idx[first_d]], daily[date_idx[last_d]]
        weekly.append({
            'weekStart': ws, 'weekLabel': f"{ws[5:].replace('/','.')} 周",
            'days': f"{first_d[5:]}~{last_d[5:]}",
            'members': lt['members'], 'power': lt['power'], 'strength': lt['strength'],
            'meritGain': lt['totalMerit'] - ft['totalMerit'],
            'powerChange': lt['power'] - ft['power'],
            'strengthChange': lt['strength'] - ft['strength'],
            'weekDonate': max(daily[date_idx[d]]['weekDonate'] for d in wdates),
            'snapshotDays': len(wdates)
        })

    # 2. 功勋累计
    members = {}
    for line in csv_cum.split('\n'):
        m = re.match(r'^\[row=(\d+)\]\s?(.*)$', line)
        if not m or int(m.group(1)) == 1:
            continue
        f = parse_line(m.group(2))
        if len(f) < 14 or not f[0].strip().startswith('M'):
            continue
        mid = f[0].strip()
        members[mid] = {
            'id': mid, 'name': f[1].strip(),
            'annualMerit': num(f[2]), 'seasonMerit': num(f[3]), 'weeklyMerit': num(f[4]),
            'active': f[5].strip(), 'activityCount': num(f[6]),
            'firstActivity': f[7].strip(), 'lastActivity': f[8].strip(),
            'lastMerit': num(f[9]), 'power': num(f[10]),
            'class': num(f[11]), 'days': num(f[12]), 'note': f[13].strip()
        }

    # 3. 最近7天趋势 + 排名
    last7 = dates[-7:]
    members_trend = defaultdict(dict)
    for r in records:
        if r['date'] in last7:
            members_trend[r['id']][r['date']] = r
    for mid, m in members.items():
        series = members_trend.get(mid, {})
        days_data, prev, prev_power = [], None, None
        for d in last7:
            snap = series.get(d)
            if snap:
                days_data.append({
                    'd': d[5:], 'power': snap['power'], 'strength': snap['strength'],
                    'totalMerit': snap['totalMerit'], 'weekMerit': snap['weekMerit'],
                    'weekDonate': snap['weekDonate'],
                    'meritGain': snap['totalMerit'] - prev if prev is not None else 0,
                    'powerChange': snap['power'] - prev_power if prev_power is not None else 0,
                })
                prev, prev_power = snap['totalMerit'], snap['power']
            else:
                days_data.append(None)
        m['trend'] = days_data

    latest_rows = [r for r in records if r['date'] == dates[-1]]
    for metric in ['power', 'strength', 'totalMerit', 'weekMerit', 'weekDonate']:
        ordered = sorted(latest_rows, key=lambda x: x[metric], reverse=True)
        for i, r in enumerate(ordered):
            if r['id'] in members:
                members[r['id']].setdefault('rank', {})[metric] = i + 1

    member_list = sorted(members.values(), key=lambda x: x['annualMerit'], reverse=True)

    # 4. 每成员逐日序列 [dIdx, totalMerit, power, strength, weekMerit, weekDonate]
    by_id_recs = defaultdict(list)
    for r in records:
        by_id_recs[r['id']].append(r)
    merit_series = {}
    for mid, recs in by_id_recs.items():
        recs.sort(key=lambda x: x['date'])
        merit_series[mid] = [[date_idx[r['date']], r['totalMerit'], r['power'],
                              r['strength'], r['weekMerit'], r['weekDonate']] for r in recs]

    # 5. 活动明细聚合
    TYPE = {'占领戈阳': 'major', '占领东治': 'major', '刷功勋': 'normal'}
    NOTES = {
        '占领戈阳': '⭐ 重要攻城，87人参与，功勋目前最高。',
        '占领东治': '⭐ 重要战斗。全盟大量阵亡，战力合计环比-5.69%，实力仅-0.87%。',
        '占领曲江': '活动发生在9/22晚。',
        '占领蕲春': '活动发生在9/30晚。',
        '刷功勋': '非攻城活动（个人代刷功勋），照常计入功勋口径。',
    }
    agg = defaultdict(lambda: {'merit': 0, 'members': set()})
    for line in csv_act.split('\n'):
        m = re.match(r'^\[row=(\d+)\]\s?(.*)$', line)
        if not m or int(m.group(1)) == 1:
            continue
        f = parse_line(m.group(2))
        if len(f) < 5 or not f[0].strip():
            continue
        key = (f[0].strip(), f[1].strip())
        agg[key]['merit'] += num(f[4])
        if f[2].strip():
            agg[key]['members'].add(f[2].strip())
    activities = []
    for (d, name) in sorted(agg.keys(), key=lambda k: k[0], reverse=True):
        a = agg[(d, name)]
        n = len(a['members'])
        activities.append({
            'date': d, 'name': name, 'participants': n, 'totalMerit': a['merit'],
            'note': NOTES.get(name, f'{n}人参与'),
            'type': TYPE.get(name, 'battle')
        })

    # 6. 写 data.js
    data = {
        'asOf': dates[-1], 'weekly': weekly, 'daily': daily,
        'members': member_list, 'activities': activities,
        'trendDates': [d[5:] for d in last7], 'meritSeries': merit_series
    }
    out = ('// 仪表盘数据（截至 ' + dates[-1] + '，由飞书表格快照生成）\n'
           'window.DASHBOARD_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    data_js = ROOT / 'assets' / 'data.js'
    old = data_js.read_text(encoding='utf-8') if data_js.exists() else ''
    if old == out:
        print('UNCHANGED 数据无变化')
        return False
    data_js.write_text(out, encoding='utf-8')

    # 7. 重新生成单文件版
    standalone()

    print(f"UPDATED 截至 {dates[-1]} | 成员 {len(member_list)} | 日 {len(daily)} | 活动 {len(activities)}")
    return True


def standalone():
    """把 huaman-dashboard.html + _shared + assets 全内联成单文件版。

    数据无变化时 main() 会提前返回，所以改了前端之后单独跑：
        python3 scripts/fetch_and_build.py --standalone
    """
    html = (ROOT / 'huaman-dashboard.html').read_text(encoding='utf-8')
    for fn in ['Outfit-Regular.ttf', 'Outfit-Bold.ttf', 'JetBrainsMono-Regular.ttf', 'JetBrainsMono-Bold.ttf']:
        b64 = base64.b64encode((ROOT / '_shared/fonts' / fn).read_bytes()).decode()
        html = html.replace(f"url('./_shared/fonts/{fn}')", f"url('data:font/ttf;base64,{b64}')")
    for src in ['./_shared/js/echarts.min.js', 'assets/data.js', 'assets/charts.js', 'assets/app.js']:
        tag = f'<script src="{src}"></script>'
        content = (ROOT / src.replace('./', '')).read_text(encoding='utf-8')
        html = html.replace(tag, '<script>\n' + content + '\n</script>')
    (ROOT / '花满天下数据仪表盘-单文件版.html').write_text(html, encoding='utf-8')
    print('STANDALONE 单文件版已重建')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--standalone':
        standalone()
        sys.exit(0)
    try:
        changed = main()
        sys.exit(0 if changed else 2)  # 2 = 无变化
    except Exception as e:
        print(f'ERROR {e}', file=sys.stderr)
        sys.exit(1)
