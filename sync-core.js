(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.FiszkiSyncCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RANKS = [
    { xp: 0,    lv: 1, title: 'Początkujący',       emoji: '🌱' },
    { xp: 150,  lv: 2, title: 'Uczeń na Starcie',   emoji: '📘' },
    { xp: 400,  lv: 3, title: 'Łowca Słówek',       emoji: '⚡' },
    { xp: 800,  lv: 4, title: 'Pogromca Kartkówek', emoji: '🔥' },
    { xp: 1400, lv: 5, title: 'Mistrz Rodzajników', emoji: '🎯' },
    { xp: 2200, lv: 6, title: 'Profesor Niemca',    emoji: '🧠' },
    { xp: 3500, lv: 7, title: 'Legenda Fiszek',     emoji: '👑' }
  ];

  const DEFAULT_RECORDS = {
    matchBestSec: null,
    articleBest: 0,
    speedBest: 0,
    scrambleTotal: 0,
    quizBestPct: null,
    typingBest: 0,
    memoryBestSec: null,
    listenBest: 0
  };

  function createDefaultState() {
    return {
      mastered: [],
      hard: [],
      xp: 0,
      streak: 0,
      bestStreak: 0,
      lastStudyDate: null,
      soundEnabled: true,
      autoSpeak: false,
      plToDe: true,
      badges: [],
      collapsedChapters: [],
      records: { ...DEFAULT_RECORDS },
      syncVersion: 1,
      updatedAt: null,
      lastResetAt: null
    };
  }

  function getRankInfo(xp) {
    const safeXp = Math.max(0, Number(xp) || 0);
    let current = RANKS[0];
    let next = RANKS[1] || null;
    for (let i = 0; i < RANKS.length; i++) {
      if (safeXp >= RANKS[i].xp) {
        current = RANKS[i];
        next = RANKS[i + 1] || null;
      }
    }
    return { current, next };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatLocalDateKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getYesterdayDateKey(todayKey) {
    const parts = String(todayKey).split('-').map(Number);
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    dt.setDate(dt.getDate() - 1);
    return formatLocalDateKey(dt);
  }

  function calculateStreakUpdate(currentState, todayKey) {
    const today = todayKey || formatLocalDateKey(new Date());
    const yesterday = getYesterdayDateKey(today);
    const prevDate = currentState.lastStudyDate || null;
    const prevStreak = Math.max(0, Number(currentState.streak) || 0);
    const prevBest = Math.max(prevStreak, Number(currentState.bestStreak) || 0);

    if (prevDate === today) {
      const nextStreak = Math.max(1, prevStreak);
      return {
        streak: nextStreak,
        bestStreak: Math.max(prevBest, nextStreak),
        lastStudyDate: today,
        incremented: false
      };
    }

    if (prevDate === yesterday && prevStreak > 0) {
      const nextStreak = prevStreak + 1;
      return {
        streak: nextStreak,
        bestStreak: Math.max(prevBest, nextStreak),
        lastStudyDate: today,
        incremented: true
      };
    }

    return {
      streak: 1,
      bestStreak: Math.max(prevBest, 1),
      lastStudyDate: today,
      incremented: prevStreak === 0 || prevDate !== today
    };
  }

  function getActiveStreakDisplay(currentState, todayKey) {
    const today = todayKey || formatLocalDateKey(new Date());
    const yesterday = getYesterdayDateKey(today);
    const prevDate = currentState.lastStudyDate || null;
    const streak = Math.max(0, Number(currentState.streak) || 0);
    if (!prevDate || (prevDate !== today && prevDate !== yesterday)) {
      return 0;
    }
    return streak;
  }

  function sanitizeUsername(raw) {
    return String(raw || '').trim().replace(/\s+/g, '');
  }

  function cleanLoginSlug(login) {
    return String(login || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ł/g, 'l')
      .replace(/[^a-z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  function normalizeLoginToEmail(login, domain) {
    const cleanDomain = String(domain || 'fiszki.app').trim().toLowerCase();
    const slug = cleanLoginSlug(login);
    return slug ? `${slug}@${cleanDomain}` : '';
  }

  function validateAuthForm(mode, fields) {
    const errors = [];
    const safeFields = fields || {};
    const password = String(safeFields.password || '');
    const rawLogin = mode === 'register' ? safeFields.username : (safeFields.identifier ?? safeFields.username);
    const login = String(rawLogin || '').trim();

    if (!login) {
      errors.push('Wpisz swój login.');
    } else if (login.length < 3 || login.length > 20) {
      errors.push('Login musi mieć od 3 do 20 znaków.');
    } else if (!/^[a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._-]+$/.test(login)) {
      errors.push('Login może zawierać tylko litery, cyfry oraz znaki _ . - (bez spacji).');
    } else if (!cleanLoginSlug(login)) {
      errors.push('Login musi zawierać litery lub cyfry.');
    }

    if (password.length < 6) {
      errors.push('Hasło musi mieć co najmniej 6 znaków.');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  function isSupabaseConfigured(config) {
    if (!config || typeof config !== 'object') return false;
    const url = String(config.url || '').trim();
    const anonKey = String(config.anonKey || '').trim();
    if (!url || !anonKey) return false;
    if (url.includes('TUTAJ_WKLEJ') || anonKey.includes('TUTAJ_WKLEJ')) return false;
    if (url.includes('TWOJ-PROJEKT') || anonKey.includes('TWOJ_')) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (_) {
      return false;
    }
  }

  function cleanExpectedAnswer(raw, isGerman) {
    let text = String(raw || '');
    if (isGerman) {
      text = text.split(',')[0].replace(/\|/g, '');
    } else {
      text = text.replace(/\s*\([^)]*\)\s*/g, ' ');
    }
    return text.replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
  }

  function foldDiacritics(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .replace(/ä/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/ü/g, 'u')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ł/g, 'l');
  }

  /**
   * Sprawdza odpowiedź wpisaną z klawiatury w grze "Pisanie Słówek".
   * Zwraca: { correct: boolean, status: 'exact'|'almost_umlaut'|'missing_article'|'wrong', expectedClean: string }
   */
  function checkTypedAnswer(userInput, expectedRaw, isGerman) {
    const expectedClean = cleanExpectedAnswer(expectedRaw, isGerman);
    const normUser = String(userInput || '')
      .replace(/\|/g, '')
      .replace(/[.!?]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const normExpected = expectedClean.toLowerCase();

    if (!normUser) {
      return { correct: false, status: 'empty', expectedClean };
    }

    if (normUser === normExpected) {
      return { correct: true, status: 'exact', expectedClean };
    }

    if (isGerman && /^(der|die|das) /.test(normExpected)) {
      const withoutArticle = normExpected.slice(4);
      if (normUser === withoutArticle) {
        return { correct: false, status: 'missing_article', expectedClean };
      }
    }

    if (foldDiacritics(normUser) === foldDiacritics(normExpected)) {
      return { correct: true, status: 'almost_umlaut', expectedClean };
    }

    return { correct: false, status: 'wrong', expectedClean };
  }

  function uniqueNumbers(arr) {
    return Array.from(new Set((Array.isArray(arr) ? arr : []).map(Number).filter(Number.isFinite)));
  }

  function uniqueStrings(arr) {
    return Array.from(new Set((Array.isArray(arr) ? arr : []).map(String).filter(Boolean)));
  }

  function parseTimestamp(iso) {
    if (!iso) return 0;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : 0;
  }

  function minPositive(a, b) {
    const vals = [a, b]
      .filter(v => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0)
      .map(Number);
    return vals.length ? Math.min(...vals) : null;
  }

  function mergeRecords(a, b) {
    const recA = { ...DEFAULT_RECORDS, ...(a || {}) };
    const recB = { ...DEFAULT_RECORDS, ...(b || {}) };

    const quizCandidates = [recA.quizBestPct, recB.quizBestPct]
      .filter(v => v !== null && v !== undefined && Number.isFinite(Number(v)))
      .map(Number);

    return {
      matchBestSec: minPositive(recA.matchBestSec, recB.matchBestSec),
      articleBest: Math.max(Number(recA.articleBest) || 0, Number(recB.articleBest) || 0),
      speedBest: Math.max(Number(recA.speedBest) || 0, Number(recB.speedBest) || 0),
      scrambleTotal: Math.max(Number(recA.scrambleTotal) || 0, Number(recB.scrambleTotal) || 0),
      quizBestPct: quizCandidates.length ? Math.max(...quizCandidates) : null,
      typingBest: Math.max(Number(recA.typingBest) || 0, Number(recB.typingBest) || 0),
      memoryBestSec: minPositive(recA.memoryBestSec, recB.memoryBestSec),
      listenBest: Math.max(Number(recA.listenBest) || 0, Number(recB.listenBest) || 0)
    };
  }

  function mergeProgressStates(localRaw, remoteRaw, options) {
    const opts = options || {};
    const local = { ...createDefaultState(), ...(localRaw || {}), records: { ...DEFAULT_RECORDS, ...((localRaw && localRaw.records) || {}) } };
    if (!remoteRaw) return local;
    const remote = { ...createDefaultState(), ...remoteRaw, records: { ...DEFAULT_RECORDS, ...(remoteRaw.records || {}) } };

    const localReset = parseTimestamp(local.lastResetAt);
    const remoteReset = parseTimestamp(remote.lastResetAt);
    const localUpdated = parseTimestamp(local.updatedAt);
    const remoteUpdated = parseTimestamp(remote.updatedAt);

    if (!opts.mergeGuest) {
      if (remoteReset > localReset && remoteReset >= localUpdated) {
        return {
          ...remote,
          soundEnabled: local.soundEnabled,
          autoSpeak: local.autoSpeak,
          plToDe: local.plToDe
        };
      }
      if (localReset > remoteReset && localReset >= remoteUpdated) {
        return { ...local };
      }
    }

    const remoteIsNewer = remoteUpdated >= localUpdated;
    const primary = remoteIsNewer ? remote : local;
    const secondary = remoteIsNewer ? local : remote;

    const mergedMastered = uniqueNumbers([...primary.mastered, ...secondary.mastered])
      .filter(id => !(primary.hard.includes(id) && !primary.mastered.includes(id)));

    const mergedHard = uniqueNumbers([...primary.hard, ...secondary.hard])
      .filter(id => !mergedMastered.includes(id));

    const mergedBadges = uniqueStrings([...local.badges, ...remote.badges]);

    const localDate = local.lastStudyDate || '';
    const remoteDate = remote.lastStudyDate || '';
    let streak = Math.max(Number(local.streak) || 0, Number(remote.streak) || 0);
    let lastStudyDate = localDate >= remoteDate ? (localDate || null) : (remoteDate || null);
    if (localDate && remoteDate && localDate !== remoteDate) {
      streak = localDate > remoteDate ? (Number(local.streak) || 0) : (Number(remote.streak) || 0);
    }

    return {
      mastered: mergedMastered,
      hard: mergedHard,
      xp: Math.max(Number(local.xp) || 0, Number(remote.xp) || 0),
      streak,
      bestStreak: Math.max(Number(local.bestStreak) || 0, Number(remote.bestStreak) || 0, streak),
      lastStudyDate,
      soundEnabled: typeof primary.soundEnabled === 'boolean' ? primary.soundEnabled : local.soundEnabled,
      autoSpeak: typeof primary.autoSpeak === 'boolean' ? primary.autoSpeak : local.autoSpeak,
      plToDe: typeof primary.plToDe === 'boolean' ? primary.plToDe : local.plToDe,
      badges: mergedBadges,
      collapsedChapters: Array.isArray(primary.collapsedChapters) ? primary.collapsedChapters : local.collapsedChapters,
      records: mergeRecords(local.records, remote.records),
      syncVersion: Math.max(Number(local.syncVersion) || 1, Number(remote.syncVersion) || 1),
      updatedAt: new Date(Math.max(localUpdated, remoteUpdated, Date.now())).toISOString(),
      lastResetAt: localReset >= remoteReset ? (local.lastResetAt || null) : (remote.lastResetAt || null)
    };
  }

  function toCloudProgressRow(userId, localState) {
    const rank = getRankInfo(localState.xp);
    return {
      user_id: userId,
      mastered: uniqueNumbers(localState.mastered),
      hard: uniqueNumbers(localState.hard),
      xp: Math.max(0, Math.round(Number(localState.xp) || 0)),
      level: rank.current.lv,
      streak: Math.max(0, Math.round(Number(localState.streak) || 0)),
      best_streak: Math.max(0, Math.round(Number(localState.bestStreak) || 0)),
      last_study_date: localState.lastStudyDate || null,
      badges: uniqueStrings(localState.badges),
      records: { ...DEFAULT_RECORDS, ...(localState.records || {}) },
      preferences: {
        soundEnabled: Boolean(localState.soundEnabled),
        autoSpeak: Boolean(localState.autoSpeak),
        plToDe: Boolean(localState.plToDe),
        collapsedChapters: Array.isArray(localState.collapsedChapters) ? localState.collapsedChapters : []
      },
      sync_version: Math.max(1, Number(localState.syncVersion) || 1),
      last_reset_at: localState.lastResetAt || null
    };
  }

  function fromCloudProgressRow(row) {
    if (!row) return null;
    const prefs = row.preferences || {};
    return {
      mastered: uniqueNumbers(row.mastered),
      hard: uniqueNumbers(row.hard),
      xp: Math.max(0, Number(row.xp) || 0),
      streak: Math.max(0, Number(row.streak) || 0),
      bestStreak: Math.max(0, Number(row.best_streak) || 0),
      lastStudyDate: row.last_study_date || null,
      soundEnabled: typeof prefs.soundEnabled === 'boolean' ? prefs.soundEnabled : true,
      autoSpeak: typeof prefs.autoSpeak === 'boolean' ? prefs.autoSpeak : false,
      plToDe: typeof prefs.plToDe === 'boolean' ? prefs.plToDe : true,
      badges: uniqueStrings(row.badges),
      collapsedChapters: Array.isArray(prefs.collapsedChapters) ? prefs.collapsedChapters : [],
      records: { ...DEFAULT_RECORDS, ...(row.records || {}) },
      syncVersion: Math.max(1, Number(row.sync_version) || 1),
      updatedAt: row.updated_at || null,
      lastResetAt: row.last_reset_at || null
    };
  }

  function getRecordsCompositeScore(entry) {
    const article = Number(entry.article_best) || 0;
    const speed = Number(entry.speed_best) || 0;
    const scramble = Number(entry.scramble_total) || 0;
    const typing = Number(entry.typing_best) || 0;
    const listen = Number(entry.listen_best) || 0;
    const quiz = Number(entry.quiz_best_pct) || 0;
    const matchBonus = entry.match_best_sec != null && entry.match_best_sec > 0
      ? Math.max(0, 120 - Number(entry.match_best_sec))
      : 0;
    const memoryBonus = entry.memory_best_sec != null && entry.memory_best_sec > 0
      ? Math.max(0, 100 - Number(entry.memory_best_sec))
      : 0;
    return article * 4 + speed * 3 + typing * 4 + listen * 4 + scramble * 2 + quiz + matchBonus + memoryBonus;
  }

  function sortLeaderboard(entries, sortBy, classFilter) {
    const list = (Array.isArray(entries) ? entries : []).filter(item => {
      if (!classFilter || classFilter === 'ALL') return true;
      return String(item.class_name || '').toLowerCase() === String(classFilter).toLowerCase();
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'streak') {
        return (Number(b.streak) || 0) - (Number(a.streak) || 0) ||
               (Number(b.best_streak) || 0) - (Number(a.best_streak) || 0) ||
               (Number(b.xp) || 0) - (Number(a.xp) || 0);
      }
      if (sortBy === 'mastered') {
        return (Number(b.mastered_count) || 0) - (Number(a.mastered_count) || 0) ||
               (Number(b.xp) || 0) - (Number(a.xp) || 0);
      }
      if (sortBy === 'records') {
        return getRecordsCompositeScore(b) - getRecordsCompositeScore(a) ||
               (Number(b.xp) || 0) - (Number(a.xp) || 0);
      }
      return (Number(b.xp) || 0) - (Number(a.xp) || 0) ||
             (Number(b.mastered_count) || 0) - (Number(a.mastered_count) || 0) ||
             (Number(b.streak) || 0) - (Number(a.streak) || 0);
    });
  }

  return {
    RANKS,
    DEFAULT_RECORDS,
    createDefaultState,
    getRankInfo,
    escapeHtml,
    formatLocalDateKey,
    getYesterdayDateKey,
    calculateStreakUpdate,
    getActiveStreakDisplay,
    sanitizeUsername,
    cleanLoginSlug,
    normalizeLoginToEmail,
    validateAuthForm,
    isSupabaseConfigured,
    cleanExpectedAnswer,
    checkTypedAnswer,
    mergeRecords,
    mergeProgressStates,
    toCloudProgressRow,
    fromCloudProgressRow,
    getRecordsCompositeScore,
    sortLeaderboard
  };
});
