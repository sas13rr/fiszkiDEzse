import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../sync-core.js');

test('normalizeLoginToEmail handles emails and Polish usernames', () => {
  assert.equal(core.normalizeLoginToEmail('Kuba@Szkola.PL'), 'kuba@szkola.pl');
  assert.equal(core.normalizeLoginToEmail('Kuba_8A'), 'kuba_8a@fiszki.local');
  assert.equal(core.normalizeLoginToEmail('Żółć 8B'), 'zolc_8b@fiszki.local');
  assert.equal(core.normalizeLoginToEmail('   '), '');
});

test('validateAuthForm rejects invalid inputs and accepts valid login/register data', () => {
  const emptyLogin = core.validateAuthForm('login', { identifier: '', password: '' });
  assert.equal(emptyLogin.valid, false);
  assert.equal(emptyLogin.errors.length, 2);

  const validLogin = core.validateAuthForm('login', { identifier: 'Kuba_8A', password: 'secret123' });
  assert.equal(validLogin.valid, true);

  const badRegister = core.validateAuthForm('register', {
    username: 'A',
    email: 'not-an-email',
    className: '8A',
    password: '123',
    confirmPassword: '456'
  });
  assert.equal(badRegister.valid, false);
  assert.ok(badRegister.errors.length >= 3);

  const goodRegisterNoEmail = core.validateAuthForm('register', {
    username: 'Kuba_8A',
    email: '',
    className: '8A',
    password: 'password123',
    confirmPassword: 'password123'
  });
  assert.equal(goodRegisterNoEmail.valid, true);

  const goodRegisterWithEmail = core.validateAuthForm('register', {
    username: 'Maja K.',
    email: 'maja@example.com',
    className: '8A',
    password: 'password123',
    confirmPassword: 'password123'
  });
  assert.equal(goodRegisterWithEmail.valid, true);
});

test('calculateStreakUpdate handles first day, same day, consecutive day, and broken streak', () => {
  const base = core.createDefaultState();
  const day1 = core.calculateStreakUpdate(base, '2026-11-20');
  assert.equal(day1.streak, 1);
  assert.equal(day1.bestStreak, 1);
  assert.equal(day1.lastStudyDate, '2026-11-20');
  assert.equal(day1.incremented, true);

  const sameDay = core.calculateStreakUpdate(day1, '2026-11-20');
  assert.equal(sameDay.streak, 1);
  assert.equal(sameDay.incremented, false);

  const day2 = core.calculateStreakUpdate(day1, '2026-11-21');
  assert.equal(day2.streak, 2);
  assert.equal(day2.bestStreak, 2);
  assert.equal(day2.incremented, true);

  const afterGap = core.calculateStreakUpdate(day2, '2026-11-25');
  assert.equal(afterGap.streak, 1);
  assert.equal(afterGap.bestStreak, 2);
  assert.equal(core.getActiveStreakDisplay(day2, '2026-11-25'), 0);
  assert.equal(core.getActiveStreakDisplay(day2, '2026-11-22'), 2);
});

test('mergeProgressStates combines phone and desktop progress without losing XP, badges, or best records', () => {
  const phone = {
    ...core.createDefaultState(),
    mastered: [1, 2, 3],
    hard: [4],
    xp: 220,
    streak: 3,
    bestStreak: 4,
    lastStudyDate: '2026-11-25',
    badges: ['first10'],
    records: { matchBestSec: 42, articleBest: 12, speedBest: 15, scrambleTotal: 4, quizBestPct: 84 },
    updatedAt: '2026-11-25T12:00:00.000Z'
  };

  const desktop = {
    ...core.createDefaultState(),
    mastered: [2, 3, 5],
    hard: [6],
    xp: 260,
    streak: 2,
    bestStreak: 5,
    lastStudyDate: '2026-11-24',
    badges: ['quizPro'],
    records: { matchBestSec: 51, articleBest: 18, speedBest: 10, scrambleTotal: 9, quizBestPct: 92 },
    updatedAt: '2026-11-25T10:00:00.000Z'
  };

  const merged = core.mergeProgressStates(phone, desktop);
  assert.deepEqual(merged.mastered.sort((a: number, b: number) => a - b), [1, 2, 3, 5]);
  assert.deepEqual(merged.hard.sort((a: number, b: number) => a - b), [4, 6]);
  assert.equal(merged.xp, 260);
  assert.equal(merged.streak, 3);
  assert.equal(merged.bestStreak, 5);
  assert.deepEqual(merged.badges.sort(), ['first10', 'quizPro']);
  assert.equal(merged.records.matchBestSec, 42);
  assert.equal(merged.records.articleBest, 18);
  assert.equal(merged.records.speedBest, 15);
  assert.equal(merged.records.scrambleTotal, 9);
  assert.equal(merged.records.quizBestPct, 92);
});

test('mergeProgressStates honors newer explicit reset across devices', () => {
  const stalePhone = {
    ...core.createDefaultState(),
    mastered: [1, 2, 3],
    xp: 400,
    updatedAt: '2026-11-25T10:00:00.000Z'
  };
  const resetCloud = {
    ...core.createDefaultState(),
    xp: 0,
    mastered: [],
    lastResetAt: '2026-11-25T11:00:00.000Z',
    updatedAt: '2026-11-25T11:00:00.000Z'
  };

  const merged = core.mergeProgressStates(stalePhone, resetCloud);
  assert.equal(merged.xp, 0);
  assert.deepEqual(merged.mastered, []);
});

test('toCloudProgressRow and fromCloudProgressRow round-trip all progress fields', () => {
  const state = {
    ...core.createDefaultState(),
    mastered: [1, 5, 12],
    hard: [7],
    xp: 450,
    streak: 4,
    bestStreak: 6,
    lastStudyDate: '2026-11-25',
    badges: ['first10', 'streak3'],
    records: { matchBestSec: 39, articleBest: 16, speedBest: 21, scrambleTotal: 11, quizBestPct: 96 }
  };

  const row = core.toCloudProgressRow('user-123', state);
  assert.equal(row.user_id, 'user-123');
  assert.equal(row.level, 3);
  assert.equal(row.streak, 4);
  assert.equal(row.best_streak, 6);

  const restored = core.fromCloudProgressRow({ ...row, updated_at: '2026-11-25T12:00:00.000Z' });
  assert.deepEqual(restored.mastered, [1, 5, 12]);
  assert.deepEqual(restored.hard, [7]);
  assert.equal(restored.xp, 450);
  assert.equal(restored.streak, 4);
  assert.equal(restored.bestStreak, 6);
  assert.deepEqual(restored.badges, ['first10', 'streak3']);
  assert.equal(restored.records.quizBestPct, 96);
});

test('sortLeaderboard orders by xp, streak, mastered, records and filters by class', () => {
  const rows = [
    { user_id: '1', username: 'Ania', class_name: '8A', xp: 500, streak: 2, best_streak: 4, mastered_count: 30, article_best: 10, speed_best: 12, scramble_total: 4, quiz_best_pct: 80, match_best_sec: 55 },
    { user_id: '2', username: 'Kuba', class_name: '8B', xp: 320, streak: 9, best_streak: 9, mastered_count: 45, article_best: 22, speed_best: 25, scramble_total: 12, quiz_best_pct: 96, match_best_sec: 32 },
    { user_id: '3', username: 'Maja', class_name: '8A', xp: 900, streak: 5, best_streak: 5, mastered_count: 60, article_best: 14, speed_best: 18, scramble_total: 8, quiz_best_pct: 88, match_best_sec: 48 }
  ];

  assert.deepEqual(core.sortLeaderboard(rows, 'xp', 'ALL').map((r: any) => r.username), ['Maja', 'Ania', 'Kuba']);
  assert.deepEqual(core.sortLeaderboard(rows, 'streak', 'ALL').map((r: any) => r.username), ['Kuba', 'Maja', 'Ania']);
  assert.deepEqual(core.sortLeaderboard(rows, 'mastered', 'ALL').map((r: any) => r.username), ['Maja', 'Kuba', 'Ania']);
  assert.deepEqual(core.sortLeaderboard(rows, 'records', 'ALL').map((r: any) => r.username), ['Kuba', 'Maja', 'Ania']);
  assert.deepEqual(core.sortLeaderboard(rows, 'xp', '8A').map((r: any) => r.username), ['Maja', 'Ania']);
});

test('escapeHtml neutralizes XSS payloads and isSupabaseConfigured checks placeholders and publishable keys', () => {
  assert.equal(core.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(core.isSupabaseConfigured({ url: 'TUTAJ_WKLEJ_PROJECT_URL', anonKey: 'TUTAJ_WKLEJ_ANON_KEY' }), false);
  assert.equal(core.isSupabaseConfigured({ url: 'https://nzggvdrwgkanzqmrbokb.supabase.co', anonKey: 'sb_publishable_uVsAdLQFg98cEFWTLr-Tuw_EyBxSphs' }), true);
});

test('checkTypedAnswer validates exact German words, separable verbs, umlaut tolerance, and missing articles', () => {
  assert.equal(core.checkTypedAnswer('die Erkältung', 'die Erkältung, -en', true).status, 'exact');
  assert.equal(core.checkTypedAnswer('aufpassen', 'auf|passen', true).correct, true);
  assert.equal(core.checkTypedAnswer('die Erkaltung', 'die Erkältung, -en', true).status, 'almost_umlaut');
  assert.equal(core.checkTypedAnswer('Erkältung', 'die Erkältung, -en', true).status, 'missing_article');
  assert.equal(core.checkTypedAnswer('das Auto', 'die Erkältung, -en', true).correct, false);
  assert.equal(core.checkTypedAnswer('przepisywać', 'przepisywać (receptę)', false).correct, true);
});

test('mergeRecords preserves new minigame records (typingBest, memoryBestSec, listenBest)', () => {
  const merged = core.mergeRecords(
    { typingBest: 8, memoryBestSec: 44, listenBest: 5 },
    { typingBest: 12, memoryBestSec: 31, listenBest: 3 }
  );
  assert.equal(merged.typingBest, 12);
  assert.equal(merged.memoryBestSec, 31);
  assert.equal(merged.listenBest, 5);
});
