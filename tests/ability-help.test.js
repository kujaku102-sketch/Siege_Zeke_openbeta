import test from 'node:test';
import assert from 'node:assert/strict';
import { abilityTextHtml, cardEffectHtml } from '../src/ui/ability-help.js';
import { ABILITY_GLOSSARY } from '../src/data/ability-glossary.js';

test('known bracket abilities and processing terms become accessible links',()=>{
 const html=abilityTextHtml('[QA][ログイン:自分]［プロテクト：2］ サルベージ [Login]');
 assert.equal((html.match(/data-ability-help=/g)??[]).length,5);
 assert.ok(html.includes(':自分'));assert.ok(html.includes('：2'));
 assert.ok(html.includes('aria-haspopup="dialog"'));
});
test('unknown conditions stay text; HTML input is escaped',()=>{
 const html=abilityTextHtml('[条件:攻撃された時] <img onerror="oops"> [未知]');
 assert.ok(!html.includes('data-ability-help'));assert.ok(!html.includes('<img'));
 assert.ok(html.includes('&lt;img'));assert.ok(html.includes('[条件:攻撃された時]'));
});
test('original visible text survives decoration and longest names resolve once',()=>{
 const original='パラレルオーバーライド [OC:3] [if:カードを実行した時]';
 const html=abilityTextHtml(original);
 assert.equal(html.replace(/<[^>]+>/g,''),original);
 assert.equal((html.match(/data-ability-help=/g)??[]).length,3);
 assert.equal(new Set(ABILITY_GLOSSARY.map(a=>a.id)).size,ABILITY_GLOSSARY.length);
 assert.equal(ABILITY_GLOSSARY.length,36);
});

test('card effect text uses approved ability images and keeps processing terms legible',()=>{
 const html=cardEffectHtml('[ログイン][QA]アクセスし、[セキュリティ]を持つObへ。レイヤー、コンポーネント。『アームズバンド・ジャケット』 [未知]');
 for(const asset of ['login.png','quick_action.png','security.png'])assert.ok(html.includes(asset));
 assert.equal((html.match(/class="ability-help-trigger effect-ability-icon"/g)??[]).length,3);
 for(const tone of ['access','layer'])assert.ok(html.includes(`data-ability-tone="${tone}"`));
 assert.ok(html.includes('effect-term-component'));
 assert.ok(html.includes('effect-card-reference'));
 assert.ok(html.includes('[未知]'));
 assert.ok(!html.includes('effect-ability-value"></span>'));
});

test('card effect numbers and unknown HTML remain safe',()=>{
 const html=cardEffectHtml('[プロテクト:2] <img onerror="oops"> [条件:攻撃された時]');
 assert.ok(html.includes('protection.png'));
 assert.ok(html.includes('effect-ability-value">:2</span>'));
 assert.ok(html.includes('&lt;img'));
 assert.ok(!html.includes('<img onerror'));
 assert.ok(html.includes('[条件:攻撃された時]'));
});
