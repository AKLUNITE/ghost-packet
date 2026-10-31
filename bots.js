// Practice CPU behaviour. Uses only what a real player could know: its own roll and public history.
(function (root) {
  'use strict';
  const pick = (a, r) => a[Math.floor(r() * a.length)];
  const LINES = {
    sus: ['ほんとに？', '怪しいなあ', '声ちょっと上ずってない？', 'お前がダウトしろよ', 'いやお前がやれってｗ', '前もそれ言ってたよね', '通していいの？これ', '俺は信じる…たぶん'],
    sus4: ['4はさすがに盛ってるだろ', '4？ 強気すぎない？', '誰か行けよ、4だぞ'],
    goal: ['それ通したらゴールだぞ', 'ゴール前で正直者になるやつ、いる？'],
    pass: ['スルーで', '…通す', '今回は見逃す', '信じた'],
    doubt: ['ダウト！', '監査入りまーす', 'それは嘘だね', 'はい、ダウト'],
    cat: ['猫動画になったｗ', 'かわいいデータでしたね', 'にゃーん', '無害化完了'],
    mis: ['あっ……', 'やらかした', '正直者かよ！', '嘘であってくれよ…'],
    self: ['ほんとだって', '信じてよ', '今回はマジ'],
  };
  function declare(pos, roll, r) {
    const need = 9 - pos;
    if (roll === 'X') return r() < 0.35 && need <= 4 ? need : pick([1, 2, 3, 3, 4, 4], r);
    let v = roll;
    if (r() > 0.74) v = Math.min(4, roll + 1 + Math.floor(r() * 2));
    else if (r() < 0.08) v = Math.max(1, roll - 1);
    return v;
  }
  // returns per-bot probability of calling a doubt this review
  function doubtChance(o) {
    let sus = { 1: 0.1, 2: 0.15, 3: 0.22, 4: 0.33 }[o.value];
    if (o.senderPos != null && o.senderPos + o.value >= 9) sus += 0.15;
    if (o.seen) sus += 0.25 * (o.lies / o.seen - 0.33);
    sus = Math.max(0.05, Math.min(0.7, sus));
    const each = 1 - Math.pow(1 - sus, 1 / Math.max(1, o.botCount));
    return o.goalStake ? each * 0.45 : each;
  }
  const NAMES = ['KAGE', 'ミント', 'ボルト', 'ヨル', 'ネズミ', 'ハルカ', 'ZERO', 'ツバメ'];
  const api = { LINES, declare, doubtChance, pick, NAMES };
  if (typeof module !== 'undefined') module.exports = api; else root.GPBots = api;
})(this);
