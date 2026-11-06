'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const resources = JSON.parse(fs.readFileSync(path.join(root, 'resources.json'), 'utf8'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
test('all jurisdictions have income, legal and health routes with source dates and both languages', () => {
  for (const region of ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']) {
    for (const category of ['income','legal','health']) assert.ok(resources.some(r=>r.region===region && r.category===category), region+' '+category);
  }
  assert.equal(new Set(resources.map(r=>r.id)).size,resources.length);
  for (const resource of resources) {
    for (const lang of ['en','fr']) for (const field of ['name','description']) assert.ok(resource[field][lang]);
    assert.match(resource.url,/^https:\/\//); assert.match(resource.source,/^https:\/\//);
    assert.match(resource.checked,/^\d{4}-\d{2}-\d{2}$/);
  }
});
for (const [name,lang] of [['index.html','en'],['fr.html','fr']]) {
  test(name+' contains a complete static directory, one H1 and unique IDs',()=>{
    const html=read(name);
    assert.ok(html.includes('<html lang="'+lang+'">'));
    assert.equal((html.match(/<h1\b/g)||[]).length,1);
    const ids=Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]);
    assert.equal(new Set(ids).size,ids.length);
    for(const resource of resources) assert.ok(html.includes('id="resource-'+resource.id+'"'));
    for(const id of ['resources','support','guides','about']) assert.ok(ids.includes(id));
    assert.ok(html.includes('id="quickExit" href="https://www.google.ca/"'));
    assert.ok(html.includes(lang==='fr'?'manifest-fr.webmanifest':'manifest.webmanifest'));
    assert.ok(html.includes(lang==='fr'?'sms:686868?body=PARLER':'sms:686868?body=CONNECT'));
    assert.doesNotMatch(html,/fonts\.google|googletagmanager|<script[^>]+src="https:/);
  });
}
function luminance(hex) {const rgb=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('primary and emergency button text exceeds 4.5:1 in both colour themes',()=>{
  for(const [bg,fg] of [['0e6e62','ffffff'],['b3261e','ffffff'],['4fbfae','10201c'],['f2857c','10201c']]) assert.ok(contrast(bg,fg)>=4.5);
});
