/* ============================================================================
   ИНСТРУМЕНТ «ГОТОВНОСТЬ» — ЯДРО
   Читает выгрузку 1С (.xlsx) без внешних библиотек, разбирает иерархию
   Контрагент -> Заказ (СП) -> Позиция, считает готовность и отдаёт
   Excel / CSV / JSON для подтягивания в CRM.
   ========================================================================== */
(function (root) {
  'use strict';

  var decoder = new TextDecoder('utf-8');
  function utf8(bytes) { return decoder.decode(bytes); }

  function unesc(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, function (m, e) {
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'amp') return '&';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      if (e.charAt(0) === '#') {
        var code = (e.charAt(1) === 'x' || e.charAt(1) === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(code); } catch (err) { return m; }
      }
      return m;
    });
  }

  function attrs(tag) {
    var out = {}, re = /([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)\s*=\s*"([^"]*)"/g, m;
    while ((m = re.exec(tag))) out[m[1]] = m[2];
    return out;
  }
  function colToNum(col) { var n = 0; for (var i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64); return n; }
  function numToCol(n) { var s = ''; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function fmtDate(d) { return d ? pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear() : ''; }
  function fmtDateIso(d) { return d ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) : null; }

  /* ------------------------------------------------------------------ CRC32 */
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  /* ------------------------------------------------- распаковка DEFLATE (JS) */
  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LBITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DBITS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLC = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function Huff(lengths, n) {
    var counts = new Uint16Array(16), i;
    for (i = 0; i < n; i++) counts[lengths[i] & 15]++;
    counts[0] = 0;
    var offs = new Uint16Array(16);
    for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    var symbols = new Uint16Array(n);
    for (i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
    this.counts = counts; this.symbols = symbols;
  }

  function inflateRaw(src) {
    var out = new Uint8Array(Math.max(65536, src.length * 4));
    var outLen = 0, pos = 0, bitBuf = 0, bitCnt = 0, fixedLit = null, fixedDist = null;

    function grow(extra) {
      if (outLen + extra <= out.length) return;
      var cap = out.length; while (cap < outLen + extra) cap *= 2;
      var nb = new Uint8Array(cap); nb.set(out.subarray(0, outLen)); out = nb;
    }
    function bits(n) {
      while (bitCnt < n) { bitBuf |= (src[pos++] || 0) << bitCnt; bitCnt += 8; }
      var v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v;
    }
    function decode(h) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len <= 15; len++) {
        code |= bits(1);
        var count = h.counts[len];
        if (code - first < count) return h.symbols[index + (code - first)];
        index += count; first = (first + count) << 1; code <<= 1;
      }
      throw new Error('Повреждённый файл: ошибка распаковки (код Хаффмана)');
    }
    function fixed() {
      if (fixedLit) return;
      var l = new Uint8Array(288), i;
      for (i = 0; i < 144; i++) l[i] = 8;
      for (i = 144; i < 256; i++) l[i] = 9;
      for (i = 256; i < 280; i++) l[i] = 7;
      for (i = 280; i < 288; i++) l[i] = 8;
      fixedLit = new Huff(l, 288);
      var d = new Uint8Array(30); for (i = 0; i < 30; i++) d[i] = 5;
      fixedDist = new Huff(d, 30);
    }
    function block(lit, dist) {
      for (;;) {
        var sym = decode(lit);
        if (sym < 256) { grow(1); out[outLen++] = sym; }
        else if (sym === 256) return;
        else {
          var li = sym - 257;
          if (li >= 29) throw new Error('Повреждённый файл: недопустимый код длины');
          var len = LBASE[li] + bits(LBITS[li]);
          var ds = decode(dist);
          var d = DBASE[ds] + bits(DBITS[ds]);
          var from = outLen - d;
          if (from < 0) throw new Error('Повреждённый файл: ссылка вне данных');
          grow(len);
          for (var k = 0; k < len; k++) out[outLen++] = out[from + k];
        }
      }
    }
    for (;;) {
      var last = bits(1), type = bits(2);
      if (type === 0) {
        bitBuf = 0; bitCnt = 0;
        var blen = (src[pos] | (src[pos + 1] << 8)) & 0xFFFF;
        var nlen = (src[pos + 2] | (src[pos + 3] << 8)) & 0xFFFF;
        pos += 4;
        if ((blen ^ 0xFFFF) !== nlen) throw new Error('Повреждённый файл: битый блок данных');
        grow(blen); out.set(src.subarray(pos, pos + blen), outLen); outLen += blen; pos += blen;
      } else if (type === 1) { fixed(); block(fixedLit, fixedDist); }
      else if (type === 2) {
        var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4, i;
        var clens = new Uint8Array(19);
        for (i = 0; i < hclen; i++) clens[CLC[i]] = bits(3);
        var clh = new Huff(clens, 19);
        var lens = new Uint8Array(hlit + hdist), n = 0;
        while (n < hlit + hdist) {
          var s = decode(clh);
          if (s < 16) lens[n++] = s;
          else if (s === 16) { var r = 3 + bits(2), pv = lens[n - 1]; while (r-- > 0) lens[n++] = pv; }
          else if (s === 17) { var r2 = 3 + bits(3); while (r2-- > 0) lens[n++] = 0; }
          else { var r3 = 11 + bits(7); while (r3-- > 0) lens[n++] = 0; }
        }
        block(new Huff(lens.subarray(0, hlit), hlit), new Huff(lens.subarray(hlit), hdist));
      } else throw new Error('Повреждённый файл: неизвестный тип блока');
      if (last) break;
    }
    return out.subarray(0, outLen);
  }

  /* ------------------------------------------------------------- чтение ZIP */
  function unzip(input) {
    var u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = -1, start = Math.max(0, u8.length - 66000);
    for (var i = u8.length - 22; i >= start; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('Это не .xlsx — не найден ZIP-каталог. Сохраните файл заново из Excel или 1С.');
    var count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
    var files = {}, p = cdOff;
    for (var k = 0; k < count; k++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = utf8(u8.subarray(p + 46, p + 46 + nameLen));
      var lnLen = dv.getUint16(lho + 26, true), leLen = dv.getUint16(lho + 28, true);
      var ds = lho + 30 + lnLen + leLen;
      var comp = u8.subarray(ds, ds + compSize);
      files[name] = (method === 0) ? comp : inflateRaw(comp);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  /* ------------------------------------------------------------ разбор .xlsx */
  var DATE_BUILTIN = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 45: 1, 46: 1, 47: 1 };

  function parseSst(xml) {
    var out = [], re = /<si\b[^>]*\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g, m;
    while ((m = re.exec(xml))) {
      if (m[1] === undefined) { out.push(''); continue; }
      var inner = m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<rPh\b[^>]*\/>/g, '');
      var t = '', tr = /<t\b[^>]*>([\s\S]*?)<\/t>/g, tm;
      while ((tm = tr.exec(inner))) t += unesc(tm[1]);
      out.push(t);
    }
    return out;
  }

  function parseStyles(xml) {
    var res = { numFmts: {}, xfs: [], fonts: [] };
    if (!xml) return res;
    var m, nfRe = /<numFmt\b[^>]*\/?>/g;
    while ((m = nfRe.exec(xml))) { var a = attrs(m[0]); if (a.numFmtId) res.numFmts[+a.numFmtId] = a.formatCode || ''; }
    var fRe = /<font\b[^>]*\/>|<font\b[^>]*>([\s\S]*?)<\/font>/g;
    while ((m = fRe.exec(xml))) {
      var fi = m[1] || '';
      var sz = /<sz\b[^>]*val="([\d.]+)"/.exec(fi);
      res.fonts.push({ bold: /<b\s*\/>/.test(fi) || /<b\b[^>]*val="(1|true)"/.test(fi), size: sz ? parseFloat(sz[1]) : 11 });
    }
    var sec = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (!sec) return res;
    var xRe = /<xf\b[^>]*\/>|<xf\b[^>]*>([\s\S]*?)<\/xf>/g;
    while ((m = xRe.exec(sec[1]))) {
      var at = attrs(m[0].slice(0, m[0].indexOf('>') + 1)), inner = m[1] || '';
      var al = /<alignment\b[^>]*\/?>/.exec(inner), aa = al ? attrs(al[0]) : {};
      var font = res.fonts[at.fontId ? +at.fontId : 0] || { bold: false, size: 11 };
      res.xfs.push({
        numFmtId: at.numFmtId ? +at.numFmtId : 0,
        fontId: at.fontId ? +at.fontId : 0,
        indent: aa.indent ? +aa.indent : 0,
        bold: !!font.bold,
        fontSize: font.size || 11
      });
    }
    return res;
  }

  function xfIsDate(styles, idx) {
    var xf = styles.xfs[idx];
    if (!xf) return false;
    if (DATE_BUILTIN[xf.numFmtId]) return true;
    var code = styles.numFmts[xf.numFmtId];
    if (!code) return false;
    var c = String(code).replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/\\./g, '');
    if (/[yYdD]/.test(c) && !/^[#0?,.]+$/.test(c)) return true;
    if (/[hHs]/.test(c) && /:/.test(c)) return true;
    return false;
  }

  /* Excel считает 1900 год високосным: серийный номер 60 — это несуществующее
     29.02.1900. Поэтому точка отсчёта 31.12.1899, а после номера 60 добавляем день.
     Раньше здесь была ошибка: даты уезжали на сутки назад. */
  var EXCEL_EPOCH = Date.UTC(1899, 11, 31);
  function serialToDate(ser) {
    var s = ser > 60 ? ser - 1 : ser;
    return new Date(EXCEL_EPOCH + Math.round(s * 86400000));
  }
  function dateToSerial(d) {
    var days = (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EXCEL_EPOCH) / 86400000;
    return days >= 60 ? days + 1 : days;
  }

  function parseSheet(xml, sst, styles) {
    var rows = [], rowRe = /<row\b[^>]*\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g, rm, rowNo = 0;
    while ((rm = rowRe.exec(xml))) {
      rowNo++;
      var ra = rm[1] ? attrs(rm[1]) : {};
      var body = rm[2] || '', cells = {};
      var cRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g, cm;
      while ((cm = cRe.exec(body))) {
        var at = attrs(cm[1] || cm[2] || ''), inner = cm[3] || '';
        var colM = /^([A-Z]+)/.exec(at.r || '');
        if (!colM) continue;
        var col = colM[1], sIdx = at.s ? +at.s : 0, type = at.t || '';
        var raw = null, num = null, text = '';
        var v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        if (type === 's' && v) { text = sst[+v[1]] || ''; raw = text; }
        else if (type === 'inlineStr') {
          var isRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g, im;
          while ((im = isRe.exec(inner))) text += unesc(im[1]);
          raw = text;
        } else if (type === 'str' && v) { text = unesc(v[1]); raw = text; }
        else if (v) {
          var val = unesc(v[1]), nv = parseFloat(val);
          raw = val;
          if (!isNaN(nv)) { num = nv; text = (xfIsDate(styles, sIdx) && nv > 0) ? fmtDate(serialToDate(nv)) : val; }
          else text = val;
        }
        cells[col] = { col: col, s: sIdx, num: num, text: text, raw: raw };
      }
      rows.push({ r: ra.r ? +ra.r : rowNo, cells: cells });
    }
    return rows;
  }

  function readXlsx(input) {
    var files = unzip(input);
    if (!files['xl/workbook.xml']) throw new Error('В файле нет листов Excel. Похоже, это не .xlsx');
    var wbXml = utf8(files['xl/workbook.xml']), rels = {};
    if (files['xl/_rels/workbook.xml.rels']) {
      var rXml = utf8(files['xl/_rels/workbook.xml.rels']), rRe = /<Relationship\b[^>]*\/?>/g, rmm;
      while ((rmm = rRe.exec(rXml))) {
        var a = attrs(rmm[0]);
        if (a.Id && a.Target) rels[a.Id] = 'xl/' + a.Target.replace(/^\/?xl\//, '').replace(/^\//, '');
      }
    }
    var sheets = [], sRe = /<sheet\b[^>]*\/?>/g, sm;
    while ((sm = sRe.exec(wbXml))) {
      var sa = attrs(sm[0]), rid = sa['r:id'] || sa.id, path = rels[rid];
      if (!path || !files[path]) { var g = 'xl/worksheets/sheet' + (sheets.length + 1) + '.xml'; path = files[g] ? g : null; }
      sheets.push({ name: sa.name || ('Лист' + (sheets.length + 1)), path: path });
    }
    var sst = files['xl/sharedStrings.xml'] ? parseSst(utf8(files['xl/sharedStrings.xml'])) : [];
    var styles = files['xl/styles.xml'] ? parseStyles(utf8(files['xl/styles.xml'])) : { numFmts: {}, xfs: [], fonts: [] };
    sheets.forEach(function (s) {
      s.rows = (s.path && files[s.path]) ? parseSheet(utf8(files[s.path]), sst, styles) : [];
    });
    return { sheets: sheets, styles: styles };
  }

  /* ------------------------------------------------------------------ утилиты */
  function toDate(str) {
    if (!str) return null;
    var m = /^(\d{2})[.\/](\d{2})[.\/](\d{4})/.exec(String(str).trim());
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }

  // 1С выгружает пустую дату как 30.12.1899 — такие значения считаем отсутствующими
  function saneDate(d) {
    if (!d) return null;
    var y = d.getFullYear();
    if (y < 2000 || y > 2100) return null;
    return d;
  }

  function cleanSpec(s) {
    return String(s == null ? '' : s)
      .replace(/^Заказ\s+покупателя\s*/i, '')
      .replace(/^Заказ\s*/i, '')
      .replace(/[,\s]+$/, '')
      .trim();
  }

  function parseOrderTitle(text) {
    var s = String(text == null ? '' : text).trim();
    var res = { raw: s, spec: cleanSpec(s), orderDate: null, readyDate: null, createdTime: null };
    var m = /^(.*?)\s+от\s+(\d{2}[.\/]\d{2}[.\/]\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?\s*(?:,\s*(\d{2}[.\/]\d{2}[.\/]\d{4})?)?\s*$/.exec(s);
    if (m) {
      res.spec = cleanSpec(m[1]);
      res.orderDate = saneDate(toDate(m[2]));
      res.createdTime = m[3] || null;
      res.readyDate = m[4] ? saneDate(toDate(m[4])) : null;
    } else {
      var only = /^(.+?),\s*(\d{2}[.\/]\d{2}[.\/]\d{4})\s*$/.exec(s);
      if (only) {
        res.spec = cleanSpec(only[1]);
        res.readyDate = saneDate(toDate(only[2]));
      }
    }
    return res;
  }

  function isTotal(t) { return /^\s*итого/i.test(String(t)); }
  function splitCipher(name) {
    var i = String(name).indexOf(',');
    return i > 0 ? String(name).slice(0, i).trim() : String(name).trim();
  }

  function guessRoles(titles, measureCols) {
    var roles = { planQty: null, planWeight: null, stockQty: null, stockWeight: null, shipQty: null, shipWeight: null };
    // смотрим только на первую часть заголовка (до разделителя групп),
    // иначе слова из чужих колонок сбивают определение роли
    function first(t) { return String(t || '').split(' / ')[0]; }
    function group(t) {
      var s = String(t || '').toLowerCase();
      if (/склад|резерв/.test(s)) return 'stock';
      if (/отгруж|факт|выполн|постав/.test(s)) return 'ship';
      if (/запланир|план|потребн|заказ/.test(s)) return 'plan';
      return null;
    }
    function unit(t) {
      var s = String(t || '').toLowerCase();
      if (/вес|кг|масса|тонн/.test(s)) return 'Weight';
      if (/кол|шт/.test(s)) return 'Qty';
      return null;
    }
    measureCols.forEach(function (c) {
      var title = titles[c] || '';
      var g = group(first(title)) || group(title);
      var u = unit(title);
      if (g && u && !roles[g + u]) roles[g + u] = c;
    });
    // запасной вариант: пары «количество, вес» по порядку колонок
    if (!roles.planQty) {
      var groups = ['plan', 'ship', 'stock'];
      for (var i = 0; i < groups.length && i * 2 + 1 < measureCols.length; i++) {
        if (!roles[groups[i] + 'Qty']) roles[groups[i] + 'Qty'] = measureCols[i * 2];
        if (!roles[groups[i] + 'Weight']) roles[groups[i] + 'Weight'] = measureCols[i * 2 + 1];
      }
    }
    return roles;
  }

  /* Собирает названия колонок из строк шапки. В шапке отчёта 1С есть строки-группы
     («Запланировано» на G, пусто на H, «Отгружено» на I ...) и строки-подписи
     («Количество», «Вес»). Групповое название «протягиваем» вправо ТОЛЬКО внутри
     мерных колонок — иначе в заголовок попадают слова из колонки A. */
  function buildTitles(headerRows, allCols, measureCols) {
    var titles = {}, carry = {};
    allCols.forEach(function (c) { titles[c] = ''; carry[c] = []; });
    headerRows.forEach(function (row) {
      var filled = measureCols.filter(function (c) { var x = row.cells[c]; return x && x.text && x.text.trim(); });
      var isLeaf = measureCols.length > 1 && filled.length === measureCols.length;
      var lastMeasure = '';
      allCols.forEach(function (c) {
        var x = row.cells[c];
        var t = x && x.text ? x.text.trim() : '';
        if (measureCols.indexOf(c) >= 0) {
          if (t) lastMeasure = t;
          else if (!isLeaf && lastMeasure) t = lastMeasure;
        }
        if (t && carry[c].indexOf(t) < 0) carry[c].push(t);
      });
    });
    allCols.forEach(function (c) { titles[c] = carry[c].join(' / '); });
    return titles;
  }

  var EPS = 1e-6;
  function statusOf(plan, stock, ship) {
    if (plan <= EPS) return 'Без плана';
    if (ship >= plan - EPS) return 'Отгружено';
    if (ship + stock >= plan - EPS) return 'Готово к отгрузке';
    if (ship + stock > EPS) return 'В работе';
    return 'Не начато';
  }

  /* Машиночитаемый код статуса — чтобы CRM не сравнивала русский текст */
  var STATUS_CODES = {
    'Отгружено': 'shipped',
    'Готово к отгрузке': 'ready',
    'В работе': 'in_progress',
    'Не начато': 'not_started',
    'Без плана': 'no_plan'
  };
  function statusCodeOf(status) { return STATUS_CODES[status] || 'unknown'; }

  /* Ключ сопоставления со спецификацией в CRM: без пробелов и в верхнем регистре */
  function specKey(s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, '').toUpperCase(); }

  /* Дата среза из имени файла: «Готовность 18.09.26 1.xlsx» -> 2026-09-18 */
  function dateFromFileName(name) {
    if (!name) return null;
    var s = String(name);
    var m = /(\d{2})[.\-_](\d{2})[.\-_](\d{4})/.exec(s);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    m = /(\d{4})[.\-_](\d{2})[.\-_](\d{2})/.exec(s);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /(\d{2})[.\-_](\d{2})[.\-_](\d{2})(?!\d)/.exec(s);
    if (m) return '20' + m[3] + '-' + m[2] + '-' + m[1];
    return null;
  }

  /* ------------------------------------------------------- разбор отчёта */
  function analyzeSheet(sheet, styles, today) {
    var rows = sheet.rows || [];
    var t0 = today ? new Date(today.getFullYear(), today.getMonth(), today.getDate())
                   : (function () { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); })();

    function hasNum(row) {
      for (var c in row.cells) if (row.cells[c].num !== null && row.cells[c].num !== undefined) return true;
      return false;
    }
    var firstData = -1, i;
    for (i = 0; i < rows.length; i++) {
      if (hasNum(rows[i]) && ((i + 1 < rows.length && hasNum(rows[i + 1])) || (i + 2 < rows.length && hasNum(rows[i + 2])))) { firstData = i; break; }
    }
    if (firstData < 0) {
      for (i = 0; i < rows.length; i++) {
        var anyText = false;
        for (var cc in rows[i].cells) if (rows[i].cells[cc].text && String(rows[i].cells[cc].text).trim()) { anyText = true; break; }
        if (anyText) { firstData = i; break; }
      }
    }
    if (firstData < 0) throw new Error('В файле не найдено ни одной строки с данными');

    var headerRows = rows.slice(0, firstData);
    var bodyRows = rows.slice(firstData);

    /* Колонка с названиями строк. В выгрузках 1С это обычно A, но в макете
       «Пример» название лежит в B, поэтому определяем её сами: самая левая
       колонка с текстом и без чисел. */
    var nameCol = (function () {
      var cols = {};
      bodyRows.forEach(function (r) { for (var c in r.cells) cols[c] = 1; });
      var order = Object.keys(cols).sort(function (a, b) { return colToNum(a) - colToNum(b); });
      var minText = bodyRows.length < 6 ? 2 : 3;
      for (var i = 0; i < order.length; i++) {
        var textCount = 0, numCount = 0;
        bodyRows.forEach(function (r) {
          var x = r.cells[order[i]];
          if (!x) return;
          if (x.num !== null && x.num !== undefined) numCount++;
          if (x.text && String(x.text).trim()) textCount++;
        });
        if (numCount === 0 && textCount >= minText) return order[i];
      }
      var best = 'A', bestCount = -1;
      order.forEach(function (c) {
        var t = 0;
        bodyRows.forEach(function (r) { var x = r.cells[c]; if (x && x.text && String(x.text).trim()) t++; });
        if (t > bestCount) { bestCount = t; best = c; }
      });
      return best;
    })();

    // строки-данные: с названием в nameCol, без строки «Итого»
    var dataRows = bodyRows.filter(function (r) { var a = r.cells[nameCol]; return a && a.text && a.text.trim() && !isTotal(a.text); });

    // уровень строки: отступ в стиле ячейки названия (иначе жирность)
    var indentSet = {};
    dataRows.forEach(function (r) {
      var sIdx = (r.cells[nameCol].s || 0);
      var xf = styles.xfs[sIdx] || { indent: 0, bold: false, fontSize: 11 };
      r.xf = xf;
      indentSet[xf.indent] = (indentSet[xf.indent] || 0) + 1;
    });
    var indents = Object.keys(indentSet).map(Number).sort(function (a, b) { return a - b; });
    var mode = 'indent', rank = {};
    if (indents.length > 1) {
      indents.forEach(function (v, k) { rank[v] = k; });
      dataRows.forEach(function (r) { r.level = rank[r.xf.indent]; });
    } else {
      mode = 'font';
      var keySet = {};
      dataRows.forEach(function (r) { keySet[(r.xf.bold ? 'b' : 'n') + Math.round(r.xf.fontSize)] = 1; });
      var keys = Object.keys(keySet);
      keys.sort(function (a, b) {
        var ab = a.charAt(0) === 'b' ? 0 : 1, bb = b.charAt(0) === 'b' ? 0 : 1;
        if (ab !== bb) return ab - bb;
        return parseFloat(b.slice(1)) - parseFloat(a.slice(1));
      });
      var frank = {};
      keys.forEach(function (k, k2) { frank[k] = k2; });
      var maxR = Math.max(1, keys.length - 1);
      dataRows.forEach(function (r) {
        var k = (r.xf.bold ? 'b' : 'n') + Math.round(r.xf.fontSize);
        r.level = frank[k] !== undefined ? frank[k] : (/^Заказ\s+покупателя/i.test(r.cells[nameCol].text) ? Math.min(1, maxR) : maxR);
      });
    }
    var maxLevel = 0;
    dataRows.forEach(function (r) { if (r.level > maxLevel) maxLevel = r.level; });

    // колонки
    var colAll = {}, colNum = {};
    bodyRows.forEach(function (r) {
      for (var c in r.cells) {
        colAll[c] = (colAll[c] || 0) + 1;
        if (r.cells[c].num !== null && r.cells[c].num !== undefined) colNum[c] = (colNum[c] || 0) + 1;
      }
    });
    var allCols = Object.keys(colAll).sort(function (a, b) { return colToNum(a) - colToNum(b); });

    // мерные колонки — те, что заполнены числами и на групповых строках тоже
    var groupRows = dataRows.filter(function (r) { return r.level < maxLevel; });
    var minGroup = Math.max(1, Math.round(groupRows.length * 0.02));
    var measureCols = allCols.filter(function (c) {
      if (c === nameCol) return false;
      if ((colNum[c] || 0) < 3) return false;
      var onGroup = groupRows.filter(function (r) { var x = r.cells[c]; return x && x.num !== null && x.num !== undefined; }).length;
      if (groupRows.length) return onGroup >= Math.min(minGroup, groupRows.length);
      return colNum[c] >= dataRows.length * 0.4;
    });
    var detailCols = allCols.filter(function (c) {
      return c !== nameCol && measureCols.indexOf(c) < 0 && (colAll[c] || 0) > 0 &&
        dataRows.some(function (r) { var x = r.cells[c]; return x && x.text && String(x.text).trim(); });
    });

    var titles = buildTitles(headerRows, allCols, measureCols);
    var roles = guessRoles(titles, measureCols);

    // дерево
    var roots = [], stack = [];
    dataRows.forEach(function (row) {
      var node = { level: row.level, name: row.cells[nameCol].text.trim(), rowIndex: row.r, cells: row.cells, own: {}, children: [], parent: null };
      measureCols.forEach(function (c) { var x = row.cells[c]; node.own[c] = (x && x.num !== null && x.num !== undefined) ? x.num : 0; });
      while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
      if (stack.length) { node.parent = stack[stack.length - 1]; node.parent.children.push(node); } else roots.push(node);
      stack.push(node);
    });
    function agg(n) {
      if (n.children.length) {
        var a = {}; measureCols.forEach(function (c) { a[c] = 0; });
        n.children.forEach(function (ch) { agg(ch); measureCols.forEach(function (c) { a[c] += ch.agg[c] || 0; }); });
        n.agg = a;
      } else {
        n.agg = {}; measureCols.forEach(function (c) { n.agg[c] = n.own[c] || 0; });
      }
      return n.agg;
    }
    roots.forEach(agg);

    // типы уровней
    var kinds = [];
    for (var lv = 0; lv <= maxLevel; lv++) {
      if (lv === maxLevel) { kinds.push('item'); continue; }
      var sample = dataRows.filter(function (r) { return r.level === lv; }).slice(0, 300);
      var orderLike = sample.filter(function (r) { return /^заказ/i.test(r.cells[nameCol].text); }).length;
      kinds.push(orderLike >= Math.max(1, sample.length * 0.5) ? 'order' : (lv === 0 ? 'contragent' : 'group'));
    }
    if (maxLevel === 0) kinds[0] = 'item';

    function fill(n, ctx) {
      n.kind = kinds[n.level] || 'group';
      var child = ctx;
      if (n.kind === 'contragent') child = { client: n.name, order: null, info: null, item: null };
      else if (n.kind === 'order') child = { client: ctx.client, order: n.name, info: parseOrderTitle(n.name), item: null };
      else if (n.kind === 'item') child = { client: ctx.client, order: ctx.order, info: ctx.info, item: n.name };
      n.ctx = child;
      n.children.forEach(function (ch) { fill(ch, child); });
    }
    roots.forEach(function (r) { fill(r, { client: null, order: null, info: null, item: null }); });

    function val(n, key) { var c = roles[key]; return c ? (n.agg[c] || 0) : 0; }
    function walk(n, fn) { fn(n); n.children.forEach(function (ch) { walk(ch, fn); }); }
    roots.forEach(function (r) {
      walk(r, function (n) {
        var planQty = val(n, 'planQty'), stockQty = val(n, 'stockQty'), shipQty = val(n, 'shipQty');
        var planW = val(n, 'planWeight'), stockW = val(n, 'stockWeight'), shipW = val(n, 'shipWeight');
        var info = n.ctx.info;
        var ready = info ? info.readyDate : null;
        var od = info ? info.orderDate : null;
        var workDays = (ready && od) ? (Math.round((new Date(ready.getFullYear(), ready.getMonth(), ready.getDate()) - new Date(od.getFullYear(), od.getMonth(), od.getDate())) / 86400000) + 1) : null;
        var late = 0;
        if (ready) {
          var rd = new Date(ready.getFullYear(), ready.getMonth(), ready.getDate());
          if (rd < t0 && statusOf(planQty, stockQty, shipQty) !== 'Отгружено') late = Math.round((t0 - rd) / 86400000);
        }
        n.m = {
          planQty: planQty, stockQty: stockQty, shipQty: shipQty,
          planWeight: planW, stockWeight: stockW, shipWeight: shipW,
          readyQty: stockQty + shipQty,
          // бывает, что на складе зарезервировано больше плана — для индикатора
          // готовности ограничиваем 100%, сами количества остаются как есть
          readyPct: planQty > EPS ? Math.min(1, (stockQty + shipQty) / planQty) : null,
          stockPct: planQty > EPS ? Math.min(1, stockQty / planQty) : null,
          notReadyQty: Math.max(0, planQty - stockQty - shipQty),
          status: statusOf(planQty, stockQty, shipQty),
          statusCode: statusCodeOf(statusOf(planQty, stockQty, shipQty)),
          orderDate: od, readyDate: ready, workDays: workDays, overdueDays: late,
          daysLeft: ready ? Math.round((new Date(ready.getFullYear(), ready.getMonth(), ready.getDate()) - t0) / 86400000) : null
        };
      });
    });

    // диагностика мерных колонок: сколько значений на каждом уровне
    var roleInfo = {};
    ['plan', 'stock', 'ship'].forEach(function (g) {
      ['Qty', 'Weight'].forEach(function (u) {
        var c = roles[g + u];
        if (c) roleInfo[g + u] = { col: c, title: titles[c] || '' };
      });
    });

    return {
      sheetName: sheet.name,
      nameCol: nameCol,
      titles: titles, allCols: allCols, measureCols: measureCols, detailCols: detailCols, roles: roles, roleInfo: roleInfo,
      levelMode: mode, maxLevel: maxLevel, kinds: kinds, roots: roots,
      today: t0,
      headerRowCount: firstData,
      bodyRowCount: bodyRows.length,
      dataRowCount: dataRows.length,
      totalRows: rows.length,
      levelCounts: (function () { var c = {}; dataRows.forEach(function (r) { c[r.level] = (c[r.level] || 0) + 1; }); return c; })(),
      indentCounts: indentSet
    };
  }

  /* -------------------------------------------------- формирование выгрузки */
  function detailValue(node, col) {
    var x = node.cells[col];
    return x && x.text ? String(x.text).trim() : '';
  }

  function pickDetail(report, re) {
    for (var i = 0; i < report.detailCols.length; i++) {
      var c = report.detailCols[i];
      if (re.test(String(report.titles[c] || ''))) return c;
    }
    return null;
  }

  function buildResult(report, opts) {
    opts = opts || {};
    var lengthCol = opts.lengthCol !== undefined ? opts.lengthCol : pickDetail(report, /длин|длина|мм|размер/i) || report.detailCols[0] || null;
    var coatCol = opts.coatCol !== undefined ? opts.coatCol : pickDetail(report, /цвет|покрыт|ral|оттенок/i) ||
      report.detailCols.filter(function (c) { return c !== lengthCol; })[0] || null;
    var roles = report.roles;
    var orders = [];

    report.roots.forEach(function (root) {
      if (root.kind !== 'contragent') {
        // на случай отчёта без группировки по контрагенту
        collect(root, null, orders);
      } else {
        root.children.forEach(function (o) { collect(o, root.name, orders); });
      }
    });

    function collect(node, client, out) {
      if (node.kind === 'contragent') return;
      if (node.kind !== 'order') { node.children.forEach(function (ch) { collect(ch, client, out); }); return; }
      var info = node.ctx.info || { spec: node.name, orderDate: null, readyDate: null, raw: node.name };
      var positions = node.children.map(function (it) {
        return {
          cipher: splitCipher(it.name),
          name: it.name,
          length: lengthCol ? detailValue(it, lengthCol) : '',
          coating: coatCol ? detailValue(it, coatCol) : '',
          details: report.detailCols.reduce(function (acc, c) {
            if (c !== lengthCol && c !== coatCol) acc[report.titles[c] || c] = detailValue(it, c);
            return acc;
          }, {}),
          planQty: it.m.planQty, stockQty: it.m.stockQty, shippedQty: it.m.shipQty,
          planWeight: it.m.planWeight, stockWeight: it.m.stockWeight, shippedWeight: it.m.shipWeight,
          readiness: it.m.readyPct, status: it.m.status, statusCode: it.m.statusCode, notReadyQty: it.m.notReadyQty
        };
      });
      out.push({
        spec: info.spec,
        client: client || node.ctx.client || '',
        orderName: node.name,
        orderDate: info.orderDate,
        readyDate: info.readyDate,
        workDays: node.m.workDays,
        planQty: node.m.planQty, stockQty: node.m.stockQty, shippedQty: node.m.shipQty,
        planWeight: node.m.planWeight, stockWeight: node.m.stockWeight, shippedWeight: node.m.shipWeight,
        readiness: node.m.readyPct, status: node.m.status, statusCode: node.m.statusCode, overdueDays: node.m.overdueDays,
        positions: positions
      });
    }

    if (opts.filters) orders = filterOrders(orders, opts.filters, report.today);
    orders.sort(function (a, b) {
      if (a.readyDate && b.readyDate) return a.readyDate - b.readyDate;
      if (a.readyDate) return -1;
      if (b.readyDate) return 1;
      return String(a.spec).localeCompare(String(b.spec), 'ru');
    });
    return { report: report, orders: orders, lengthCol: lengthCol, coatCol: coatCol };
  }

  function filterOrders(orders, f, today) {
    var q = (f.search || '').trim().toLowerCase();
    var from = f.readyFrom ? toDate(f.readyFrom) : null;
    var to = f.readyTo ? toDate(f.readyTo) : null;
    var clients = f.clients && f.clients.length ? f.clients : null;
    var statuses = f.statuses && f.statuses.length ? f.statuses : null;
    return orders.filter(function (o) {
      if (clients && clients.indexOf(o.client) < 0) return false;
      if (statuses && statuses.indexOf(o.status) < 0) return false;
      if (from && (!o.readyDate || o.readyDate < from)) return false;
      if (to && (!o.readyDate || o.readyDate > to)) return false;
      if (f.onlyOverdue && !(o.overdueDays > 0)) return false;
      if (f.onlyNotReady && o.status === 'Отгружено') return false;
      if (f.onlyStock) o = o; // позиции фильтруются ниже
      if (q) {
        var hay = (o.spec + ' ' + o.client + ' ' + o.orderName + ' ' + o.positions.map(function (p) { return p.cipher + ' ' + p.coating; }).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).map(function (o) {
      if (f.onlyNotReady || f.onlyOverdue || f.search) {
        // оставляем заказы целиком — фильтр по позициям не применяем
      }
      return o;
    });
  }

  /* --------------------------------------------------- колонки для таблицы */
  function flatColumns(result, opts) {
    opts = opts || {};
    var r = result.report;
    var cols = [
      { id: 'spec', title: 'СП', kind: 'text', width: 14, get: function (o) { return o.spec; } },
      { id: 'client', title: 'Клиент', kind: 'text', width: 26, get: function (o) { return o.client; } },
      { id: 'orderDate', title: 'Дата заказа', kind: 'date', width: 12, get: function (o) { return o.orderDate; } },
      { id: 'readyDate', title: 'Плановая дата готовности', kind: 'date', width: 16, get: function (o) { return o.readyDate; } },
      { id: 'workDays', title: 'Дней на работу', kind: 'int', width: 12, noSum: true, get: function (o) { return o.workDays; } },
      { id: 'cipher', title: 'Шифр', kind: 'text', width: 16, get: function (o) { return o.cipher; } },
      { id: 'name', title: 'Номенклатура', kind: 'text', width: 44, get: function (o) { return o.name; } },
      { id: 'length', title: 'Длина профиля', kind: 'text', width: 13, get: function (o) { return o.length; } },
      { id: 'coating', title: 'Покрытие', kind: 'text', width: 20, get: function (o) { return o.coating; } },
      { id: 'planQty', title: 'План, кол-во', kind: 'num', width: 12, get: function (o) { return o.planQty; } },
      { id: 'stockQty', title: 'На складе, кол-во', kind: 'num', width: 15, get: function (o) { return o.stockQty; } },
      { id: 'shippedQty', title: 'Отгружено, кол-во', kind: 'num', width: 14, get: function (o) { return o.shippedQty; } },
      { id: 'notReadyQty', title: 'Не готово, кол-во', kind: 'num', width: 14, get: function (o) { return o.notReadyQty; } },
      { id: 'planWeight', title: 'План, вес', kind: 'num', width: 13, get: function (o) { return o.planWeight; } },
      { id: 'stockWeight', title: 'На складе, вес', kind: 'num', width: 14, get: function (o) { return o.stockWeight; } },
      { id: 'readiness', title: 'Готовность, %', kind: 'pct', width: 13, get: function (o) { return o.readiness; } },
      { id: 'status', title: 'Статус', kind: 'text', width: 20, get: function (o) { return o.status; } },
      { id: 'overdueDays', title: 'Просрочка, дней', kind: 'int', width: 13, noSum: true, get: function (o) { return o.overdueDays; } }
    ];
    if (!r.roles.shipQty) cols = cols.filter(function (c) { return c.id !== 'shippedQty'; });
    if (!r.roles.planWeight && !r.roles.stockWeight) cols = cols.filter(function (c) { return c.id !== 'planWeight' && c.id !== 'stockWeight'; });
    if (opts.columnIds && opts.columnIds.length) {
      var keep = {};
      opts.columnIds.forEach(function (id) { keep[id] = 1; });
      cols = cols.filter(function (c) { return keep[c.id]; });
    }
    return cols;
  }

  var DEFAULT_COLUMNS = ['spec', 'client', 'readyDate', 'workDays', 'cipher', 'length', 'coating', 'planQty', 'stockQty', 'readiness', 'status'];
  var ORDER_COLUMNS = ['spec', 'client', 'orderDate', 'readyDate', 'workDays', 'planQty', 'stockQty', 'shippedQty', 'planWeight', 'stockWeight', 'readiness', 'status', 'overdueDays'];

  function flatten(result, opts) {
    var cols = flatColumns(result, opts);
    var rows = [];
    result.orders.forEach(function (o) {
      o.positions.forEach(function (p) {
        var row = { spec: o.spec, client: o.client, orderDate: o.orderDate, readyDate: o.readyDate, workDays: o.workDays };
        for (var k in p) row[k] = p[k];
        row.orderStatus = o.status;
        rows.push({ order: o, pos: p, data: row });
      });
    });
    var totals = cols.map(function (c) {
      if (c.noSum || (c.kind !== 'num' && c.kind !== 'int')) return '';
      var s = 0;
      rows.forEach(function (r) { var v = c.get(r.data); if (typeof v === 'number' && isFinite(v)) s += v; });
      return s;
    });
    if (cols.length && cols[0].kind === 'text') totals[0] = 'Итого: ' + rows.length + ' ' + plural(rows.length, 'позиция', 'позиции', 'позиций');
    return {
      columns: cols,
      rows: rows.map(function (r) { return cols.map(function (c) { var v = c.get(r.data); return v === undefined ? null : v; }); }),
      raw: rows,
      total: totals
    };
  }

  function orderTable(result, opts) {
    var cols = flatColumns(result, { columnIds: ORDER_COLUMNS });
    var rows = result.orders.map(function (o) {
      return cols.map(function (c) { var v = c.get(o); return v === undefined ? null : v; });
    });
    return {
      columns: cols, rows: rows,
      total: cols.map(function (c, i) {
        if (i === 0) return 'Итого: ' + result.orders.length + ' заказов';
        if (c.noSum || (c.kind !== 'num' && c.kind !== 'int')) return '';
        var s = 0;
        result.orders.forEach(function (o) { var v = c.get(o); if (typeof v === 'number' && isFinite(v)) s += v; });
        return s;
      })
    };
  }

  /* ------------------------------------------------------------ запись .xlsx */
  var ST = { DEF: 0, HEAD: 1, TEXT: 2, NUM: 3, PCT: 4, DATE: 5, INT: 6, ACCENT: 7, GOOD: 8, WARN: 9, BAD: 10, BOLD: 11, BOLD_NUM: 12, GROUP: 13 };

  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="5">' +
    '<numFmt numFmtId="164" formatCode="#,##0.###"/>' +
    '<numFmt numFmtId="165" formatCode="0.0%"/>' +
    '<numFmt numFmtId="166" formatCode="DD.MM.YYYY"/>' +
    '<numFmt numFmtId="167" formatCode="#,##0"/>' +
    '<numFmt numFmtId="168" formatCode="#,##0.00"/>' +
    '</numFmts>' +
    '<fonts count="7">' +
    '<font><sz val="10"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="10"/><name val="Calibri"/></font>' +
    '<font><sz val="10"/><color rgb="FF0B5CAB"/><name val="Calibri"/></font>' +
    '<font><sz val="10"/><color rgb="FF1F7244"/><name val="Calibri"/></font>' +
    '<font><sz val="10"/><color rgb="FF9C6500"/><name val="Calibri"/></font>' +
    '<font><sz val="10"/><color rgb="FF9C0006"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="7">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4E4"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFBFCEE0"/></left><right style="thin"><color rgb="FFBFCEE0"/></right><top style="thin"><color rgb="FFBFCEE0"/></top><bottom style="thin"><color rgb="FFBFCEE0"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="14">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="6" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="167" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function xmlEsc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function tableSheetXml(table, opts) {
    opts = opts || {};
    var cols = table.columns, nCols = cols.length;
    var totalRows = table.rows.length + 1 + (table.total && table.total.some(function (v) { return v !== '' && v !== null; }) ? 1 : 0);
    var lastCol = numToCol(Math.max(1, nCols));
    var o = [];
    o.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    o.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
    o.push('<dimension ref="A1:' + lastCol + Math.max(1, totalRows) + '"/>');
    o.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>');
    o.push('<sheetFormatPr defaultRowHeight="15"/>');
    o.push('<cols>');
    cols.forEach(function (c, i) { o.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 14) + '" customWidth="1"/>'); });
    o.push('</cols><sheetData>');
    o.push('<row r="1" ht="32" customHeight="1">');
    cols.forEach(function (c, i) { o.push('<c r="' + numToCol(i + 1) + '1" s="' + ST.HEAD + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(c.title) + '</t></is></c>'); });
    o.push('</row>');

    table.rows.forEach(function (row, ri) {
      var r = ri + 2;
      o.push('<row r="' + r + '">');
      row.forEach(function (v, ci) {
        var c = cols[ci], ref = numToCol(ci + 1) + r, style = ST.TEXT;
        if (c.kind === 'num' || c.kind === 'int') style = ST.NUM;
        else if (c.kind === 'pct') style = ST.PCT;
        else if (c.kind === 'date') style = ST.DATE;
        if (c.id === 'status') {
          if (v === 'Отгружено') style = ST.GOOD;
          else if (v === 'Готово к отгрузке') style = ST.WARN;
          else if (v === 'В работе') style = ST.ACCENT;
          else if (v === 'Не начато' || v === 'Без плана') style = ST.BAD;
        }
        if (c.id === 'overdueDays' && typeof v === 'number' && v > 0) style = ST.BAD;
        if (v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) {
          o.push('<c r="' + ref + '" s="' + style + '"/>');
        } else if (c.kind === 'date') {
          var d = (v instanceof Date) ? v : toDate(v);
          if (d) o.push('<c r="' + ref + '" s="' + style + '"><v>' + dateToSerial(d) + '</v></c>');
          else o.push('<c r="' + ref + '" s="' + ST.TEXT + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>');
        } else if (c.kind === 'num' || c.kind === 'int' || c.kind === 'pct') {
          var nv = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
          if (isFinite(nv)) o.push('<c r="' + ref + '" s="' + style + '"><v>' + (Math.round(nv * 1e6) / 1e6) + '</v></c>');
          else o.push('<c r="' + ref + '" s="' + ST.TEXT + '"/>');
        } else {
          o.push('<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>');
        }
      });
      o.push('</row>');
    });

    if (table.total && table.total.some(function (v) { return v !== '' && v !== null && v !== undefined; })) {
      var tr = table.rows.length + 2;
      o.push('<row r="' + tr + '">');
      table.total.forEach(function (v, ci) {
        var c = cols[ci], ref = numToCol(ci + 1) + tr;
        var style = (c.kind === 'num' || c.kind === 'int') ? ST.BOLD_NUM : ST.BOLD;
        if (typeof v === 'number' && isFinite(v)) o.push('<c r="' + ref + '" s="' + style + '"><v>' + (Math.round(v * 1e6) / 1e6) + '</v></c>');
        else if (v === '' || v === null || v === undefined) o.push('<c r="' + ref + '" s="' + ST.BOLD + '"/>');
        else o.push('<c r="' + ref + '" s="' + ST.BOLD + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>');
      });
      o.push('</row>');
    }
    o.push('</sheetData>');
    if (table.rows.length > 0 && nCols > 0) o.push('<autoFilter ref="A1:' + lastCol + (table.rows.length + 1) + '"/>');
    o.push('</worksheet>');
    return o.join('');
  }

  function rawSheetXml(title, lines, width) {
    var o = [];
    o.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    o.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    o.push('<dimension ref="A1:A' + Math.max(1, lines.length) + '"/>');
    o.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
    o.push('<sheetFormatPr defaultRowHeight="15"/>');
    o.push('<cols><col min="1" max="1" width="' + (width || 110) + '" customWidth="1"/></cols>');
    o.push('<sheetData>');
    lines.forEach(function (t, i) {
      var style = (i === 0) ? ST.BOLD : ST.TEXT;
      o.push('<row r="' + (i + 1) + '"><c r="A' + (i + 1) + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(t) + '</t></is></c></row>');
    });
    o.push('</sheetData></worksheet>');
    return o.join('');
  }

  function zipFiles(entries) {
    var parts = [], central = [], offset = 0;
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    entries.forEach(function (e) {
      var nb = new TextEncoder().encode(e.name);
      var data = e.data instanceof Uint8Array ? e.data : new TextEncoder().encode(e.data);
      var crc = crc32(data);
      var lh = new Uint8Array(30 + nb.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
      dv.setUint16(10, dosTime, true); dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, nb.length, true); dv.setUint16(28, 0, true);
      lh.set(nb, 30);
      parts.push(lh, data);

      var ch = new Uint8Array(46 + nb.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true); cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, nb.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
      ch.set(nb, 46);
      central.push(ch);
      offset += lh.length + data.length;
    });
    var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0);
    var eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
    var all = parts.concat(central, [eocd]);
    var total = all.reduce(function (s, a) { return s + a.length; }, 0);
    var res = new Uint8Array(total), p = 0;
    all.forEach(function (a) { res.set(a, p); p += a.length; });
    return res;
  }

  function writeXlsx(sheets) {
    var entries = [];
    entries.push({
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
        '</Types>'
    });
    entries.push({
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    });
    entries.push({
      name: 'xl/workbook.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map(function (s, i) { return '<sheet name="' + xmlEsc(String(s.name || ('Лист' + (i + 1))).slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') +
        '</sheets></workbook>'
    });
    entries.push({
      name: 'xl/_rels/workbook.xml.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    });
    entries.push({ name: 'xl/styles.xml', data: STYLES_XML });
    sheets.forEach(function (s, i) {
      var xml = s.raw ? rawSheetXml(s.name, s.lines, s.width) : tableSheetXml(s, s.opts || {});
      entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: xml });
    });
    return zipFiles(entries);
  }

  /* --------------------------------------------------------------- CSV / JSON */
  function numStr(v, frac) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v !== 'number' || !isFinite(v)) return String(v);
    return v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: frac === undefined ? 3 : frac });
  }

  function cellText(v, kind) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return fmtDate(v);
    if (kind === 'pct') return typeof v === 'number' ? numStr(v * 100, 1) : '';
    if (kind === 'num' || kind === 'int') return numStr(v, 3);
    return String(v);
  }

  function toCsv(table) {
    function q(s) {
      s = String(s === null || s === undefined ? '' : s);
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [table.columns.map(function (c) { return q(c.title); }).join(';')];
    table.rows.forEach(function (r) {
      lines.push(r.map(function (v, i) { return q(cellText(v, table.columns[i].kind)); }).join(';'));
    });
    if (table.total && table.total.some(function (v) { return v !== '' && v !== null; })) {
      lines.push(table.total.map(function (v, i) { return q(cellText(v, table.columns[i].kind)); }).join(';'));
    }
    return '\ufeff' + lines.join('\r\n');
  }

  /* ------------------------------------------------------------------ JSON
     Формат обмена с CRM. Контракт описан в Спецификация_формата_для_CRM.md,
     изменение полей = изменение версии schemaVersion. */
  var SCHEMA_VERSION = 1;
  function r3(v) { return Math.round((v || 0) * 1000) / 1000; }
  function r1pct(v) { return v === null || v === undefined ? null : Math.round(v * 1000) / 10; }

  function toJson(result, opts) {
    opts = opts || {};
    var r = result.report;
    var sum = function (f) { return result.orders.reduce(function (s, o) { return s + f(o); }, 0); };
    var positions = sum(function (o) { return o.positions.length; });
    var planQty = sum(function (o) { return o.planQty; });
    var stockQty = sum(function (o) { return o.stockQty; });
    var shipQty = sum(function (o) { return o.shippedQty; });
    var asOf = opts.asOfDate || dateFromFileName(opts.sourceFile) || fmtDateIso(r.today);

    function pt(p) {
      return {
        cipher: p.cipher,
        name: p.name,
        length: p.length,
        coating: p.coating,
        planQty: r3(p.planQty),
        stockQty: r3(p.stockQty),
        shippedQty: r3(p.shippedQty),
        notReadyQty: r3(p.notReadyQty),
        planWeight: r3(p.planWeight),
        stockWeight: r3(p.stockWeight),
        readiness: r1pct(p.readiness),
        status: p.status,
        statusCode: p.statusCode
      };
    }

    var payload = {
      schemaVersion: SCHEMA_VERSION,
      asOfDate: asOf,
      generatedAt: new Date().toISOString(),
      sourceFile: opts.sourceFile || null,
      sheet: r.sheetName,
      columns: {
        planQty: r.roles.planQty, planWeight: r.roles.planWeight,
        stockQty: r.roles.stockQty, stockWeight: r.roles.stockWeight,
        shippedQty: r.roles.shipQty, shippedWeight: r.roles.shipWeight,
        length: result.lengthCol, coating: result.coatCol
      },
      totals: {
        orders: result.orders.length,
        positions: positions,
        planQty: r3(planQty),
        stockQty: r3(stockQty),
        shippedQty: r3(shipQty),
        planWeight: r3(sum(function (o) { return o.planWeight; })),
        stockWeight: r3(sum(function (o) { return o.stockWeight; })),
        readiness: planQty > 0 ? r1pct(Math.min(1, (stockQty + shipQty) / planQty)) : null
      },
      orders: result.orders.map(function (o) {
        return {
          specification: o.spec,
          specificationKey: specKey(o.spec),
          client: o.client,
          orderDate: fmtDateIso(o.orderDate),
          planReadyDate: fmtDateIso(o.readyDate),
          workDays: o.workDays,
          planQty: r3(o.planQty),
          stockQty: r3(o.stockQty),
          shippedQty: r3(o.shippedQty),
          notReadyQty: r3(Math.max(0, o.planQty - o.stockQty - o.shippedQty)),
          planWeight: r3(o.planWeight),
          stockWeight: r3(o.stockWeight),
          shippedWeight: r3(o.shippedWeight),
          readiness: r1pct(o.readiness),
          status: o.status,
          statusCode: o.statusCode,
          overdueDays: o.overdueDays,
          positionCount: o.positions.length,
          positions: o.positions.map(pt)
        };
      })
    };
    return JSON.stringify(payload, null, 2);
  }

  root.ENGINE = {
    readXlsx: readXlsx,
    analyzeSheet: function (wb, idx, today) { return analyzeSheet(wb.sheets[idx], wb.styles, today); },
    buildResult: buildResult,
    flatColumns: flatColumns,
    flatten: flatten,
    orderTable: orderTable,
    writeXlsx: writeXlsx,
    toCsv: toCsv,
    toJson: toJson,
    fmtDate: fmtDate,
    fmtDateIso: fmtDateIso,
    numStr: numStr,
    parseOrderTitle: parseOrderTitle,
    toDate: toDate,
    specKey: specKey,
    statusCodeOf: statusCodeOf,
    dateFromFileName: dateFromFileName,
    SCHEMA_VERSION: SCHEMA_VERSION,
    STATUS_CODES: STATUS_CODES,
    DEFAULT_COLUMNS: DEFAULT_COLUMNS,
    ORDER_COLUMNS: ORDER_COLUMNS,
    STATUSES: ['Отгружено', 'Готово к отгрузке', 'В работе', 'Не начато', 'Без плана'],
    _t: { unzip: unzip, inflateRaw: inflateRaw, crc32: crc32, zipFiles: zipFiles, numToCol: numToCol, colToNum: colToNum }
  };
})(typeof window !== 'undefined' ? window : globalThis);
