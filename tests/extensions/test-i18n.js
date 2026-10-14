'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {localeBundle, getMessage, localizedField, makeLocaleScript} = require('../../build/extensions/extension-i18n');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-i18n-'));
try {
  for (const [loc, name] of Object.entries({en:'Read Frog', zh_CN:'陪读蛙'})) {
    fs.mkdirSync(path.join(dir,'_locales',loc),{recursive:true});
    fs.writeFileSync(path.join(dir,'_locales',loc,'messages.json'), JSON.stringify({extName:{message:name}, hey:{message:'Hello $USER$',placeholders:{user:{content:'$1'}}}}));
  }
  const m = {name:'__MSG_extName__',default_locale:'en'};
  assert.equal(localizedField(dir,m,m.name,'zh-CN'),'陪读蛙');
  assert.equal(localizedField(dir,m,m.name,'fr-FR'),'Read Frog');
  assert.equal(localizedField(dir,m,'Dark Reader','zh-CN'),'Dark Reader');
  assert.equal(getMessage(localeBundle(dir,m,'en'),'hey','World'),'Hello World');
  const context = {};
  vm.runInNewContext(makeLocaleScript(localeBundle(dir,m,'zh-CN')),context);
  assert.equal(context.__obsidianBridgeLocaleData.messages.extname.message,'陪读蛙');
  // No untrusted locale name may traverse directories; a symlink must not escape.
  assert.equal(localizedField(dir,{...m,default_locale:'../../outside'},m.name,'fr'),'Read Frog');
  console.log('PASS: localized manifest title, preferred locale fallback, placeholders and safe JS data');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
