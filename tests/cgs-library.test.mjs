import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable, PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { harness, DATA, waitJob } from './harness.mjs';
import { settingsWithDefaults, referenceImages, validateRequest, buildProviderRequest } from '../server-plugin/character-gallery-api/core.mjs';
import { migrateGallery, applyReferenceSet, requestedReferenceIds } from '../server-plugin/character-gallery-api/collections.mjs';
import { backupRecords, stageBackup, streamBackup, portableGallery } from '../server-plugin/character-gallery-api/backup.mjs';
import { imageBytes } from '../server-plugin/character-gallery-api/index.mjs';
async function setup(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cgs-library-')); t.after(() => fs.rm(root, { recursive: true, force: true })); const h = harness(root); const g = (await h.invoke('post', '/gallery/open', { avatar: 'Alice.png', name: 'Alice' })).data; return { root, h, g }; }
const upload = async (h, g, name = 'Image') => (await h.invoke('post', `/gallery/${g.id}/images`, { dataUrl: DATA, name })).data.image;
const read = async (h, g) => (await h.invoke('get', `/gallery/${g.id}`)).data;
const action = (h, g, body) => h.invoke('post', `/gallery/${g.id}/organize`, body);
const send = (h, g, ids) => h.invoke('post', `/gallery/${g.id}/generate`, { settings: settingsWithDefaults({ prompt: 'Portrait', referenceMode: 'selected', selectedIds: ids, providers: { openrouter: { model: 'test/ref' } } }) });
async function packed(root, g) { const chunks = []; for await (const row of backupRecords(g, path.join(root, 'character-gallery-studio', g.id))) chunks.push(row); return gzipSync(chunks.join('')); }

test('migration keeps existing generated images approved; only new outputs enter Review', async t => {
    const legacy = migrateGallery({ images: [{ id: 'legacy', source: 'generated' }] }); assert.equal(legacy.images[0].state, 'kept');
    const { h, g } = await setup(t), image = await upload(h, g); await send(h, g, [image.id]); const result = await waitJob(h, g.id);
    assert.equal(result.images.find(i => i.source === 'generated').state, 'review'); assert.equal(result.images.find(i => i.id === image.id).state, 'kept');
});
test('albums store multiple memberships without copying original files', async t => {
    const { h, g, root } = await setup(t), image = await upload(h, g);
    const a = (await action(h,g,{action:'album-create',name:'Portraits'})).data.album;
    const b = (await action(h,g,{action:'album-create',name:'Favorites'})).data.album;
    for (const albumId of [a.id,b.id,a.id]) assert.equal((await action(h,g,{action:'album-add',ids:[image.id],albumId})).code,200);
    assert.deepEqual((await read(h,g)).images[0].albumIds,[a.id,b.id]);
    assert.equal((await fs.readdir(path.join(root,'character-gallery-studio',g.id))).filter(f=>f.endsWith('.png')).length,1);
    await action(h,g,{action:'album-delete',albumId:a.id}); assert.deepEqual((await read(h,g)).images[0].albumIds,[b.id]);
});
test('trash retains bytes and saved set IDs, restoration returns base, purge needs confirmation', async t => {
    const { h,g,root } = await setup(t), image = await upload(h,g);
    await h.invoke('post',`/gallery/${g.id}/main`,{imageId:image.id});
    const set=(await action(h,g,{action:'set-save',set:{name:'Default',identityIds:[image.id],baseId:image.id}})).data.set;
    await h.invoke('delete',`/gallery/${g.id}/images`,{ids:[image.id]}); let gallery=await read(h,g);
    assert.equal(gallery.images.length,0); assert.equal(gallery.trash.length,1); assert.equal(gallery.referenceSets[0].identityIds[0],image.id);
    await fs.access(path.join(root,'character-gallery-studio',g.id,image.filename));
    assert.throws(()=>applyReferenceSet(settingsWithDefaults(),set,gallery),/missing|deleted/);
    assert.equal((await action(h,g,{action:'purge',ids:[image.id]})).code,400);
    await action(h,g,{action:'restore',ids:[image.id]}); gallery=await read(h,g); assert.equal(gallery.mainImageId,image.id); assert.equal(gallery.trash.length,0);
    await action(h,g,{action:'trash',ids:[image.id]}); await action(h,g,{action:'purge',ids:[image.id],confirm:'DELETE'});
    await assert.rejects(fs.access(path.join(root,'character-gallery-studio',g.id,image.filename))); assert.equal((await read(h,g)).trash.length,0);
});
test('reference sets persist identity/temp order, base and guidance; favorites survive reload', async t => {
    const {h,g,root}=await setup(t), a=await upload(h,g,'Face'),b=await upload(h,g,'Outfit');
    const response=await action(h,g,{action:'set-save',set:{name:'Casual',identityIds:[a.id],temporaryIds:[b.id],baseId:b.id,guidance:'Base outfit, second image identity.'}}); assert.equal(response.code,200);
    const gallery=await read(h,g),settings=applyReferenceSet(settingsWithDefaults(),response.data.set,gallery);
    settings.prompt='Same person'; settings.providers.openrouter.model='test/ref'; settings.favoriteModels.openrouter=['test/ref'];
    assert.deepEqual(referenceImages(gallery,settings).map(i=>i.id),[b.id,a.id]);
    await h.invoke('patch',`/gallery/${g.id}/settings`,{settings}); const restarted=harness(root); const fresh=await read(restarted,g);
    assert.equal(fresh.settings.activeReferenceSetId,response.data.set.id); assert.deepEqual(fresh.settings.favoriteModels.openrouter,['test/ref']);
    const m=(await h.invoke('get','/models/openrouter')).data.models[0];
    const request=buildProviderRequest(m,settings,[DATA,DATA]); assert.match(request.body.prompt,/Reference guidance/); assert.equal(request.body.input_references.length,2);
    settings.selectedIds=[]; assert.deepEqual(requestedReferenceIds(gallery,settings),[a.id]);
    settings.identityIds.push('missing'); assert.throws(()=>validateRequest(m,settings,referenceImages(gallery,settings)),/missing/);
});
test('archive and keep are reversible metadata actions; unknown IDs cannot affect another gallery',async t=>{
    const {h,g}=await setup(t),a=await upload(h,g);
    assert.equal((await action(h,g,{action:'archive',ids:[a.id]})).code,200); assert.equal((await read(h,g)).images[0].state,'archived');
    await action(h,g,{action:'keep',ids:[a.id]}); assert.equal((await read(h,g)).images[0].state,'kept');
    assert.equal((await action(h,g,{action:'trash',ids:['another-gallery']})).code,400); assert.equal((await read(h,g)).images.length,1);
});
test('thumbnail cache never replaces or changes the original used for generation',async t=>{
    const {h,g}=await setup(t),a=await upload(h,g);
    assert.equal((await h.invoke('post',`/gallery/${g.id}/image/${a.id}/thumbnail`,{dataUrl:DATA})).code,200);
    const thumb=await h.invoke('get',`/gallery/${g.id}/image/${a.id}/thumbnail`); assert.equal(thumb.code,200);
    await send(h,g,[a.id]); const result=await waitJob(h,g.id); assert.equal(result.jobs[0].receipt.originals[0].sha256,a.sha256); assert.equal(h.provider.requests[0].body.input_references[0].image_url.url,DATA);
});
test('backup preview and additive import restore originals, trash, albums, sets and settings without keys',async t=>{
    const {h,g,root}=await setup(t),a=await upload(h,g,'Face'),b=await upload(h,g,'Other');
    const album=(await action(h,g,{action:'album-create',name:'Portraits'})).data.album; await action(h,g,{action:'album-add',ids:[a.id],albumId:album.id});
    await action(h,g,{action:'set-save',set:{name:'Face',identityIds:[a.id],baseId:a.id}});
    await action(h,g,{action:'trash',ids:[b.id]});
    const settings=settingsWithDefaults({prompt:'Remember this',identityIds:[a.id],providers:{openrouter:{model:'test/ref'}}});
    await h.invoke('patch',`/gallery/${g.id}/settings`,{settings:{...settings,apiKey:'never-export-me'}});
    let gallery=await read(h,g); gallery.apiKey='secret'; gallery.settings.apiKey='secret'; gallery.jobs.push({id:'history',status:'sending',settings:{apiKey:'secret'}});
    assert.ok(!JSON.stringify(portableGallery(gallery)).includes('secret'));
    const directory=path.join(root,'character-gallery-studio'); const preview=await stageBackup(Readable.from([await packed(root,gallery)]),directory,imageBytes);
    assert.equal(preview.summary.images,1);assert.equal(preview.summary.trash,1);
    const target=(await h.invoke('post','/gallery/open',{avatar:'Bob.png',name:'Bob'})).data; const original=await upload(h,target,'Existing');
    const imported=await h.invoke('post',`/gallery/${target.id}/import`,{token:preview.token,applySettings:true}); assert.equal(imported.code,200);
    const after=await read(h,target);assert.equal(after.images.length,2);assert.ok(after.images.some(i=>i.id===original.id));assert.equal(after.trash.length,1);
    assert.equal(after.settings.prompt,'Remember this');const face=after.images.find(i=>i.name==='Face');assert.notEqual(face.id,a.id);assert.deepEqual(after.referenceSets[0].identityIds,[face.id]);assert.equal(face.albumIds[0],after.albums[0].id);
    assert.equal(after.jobs[0].status,'interrupted');assert.equal(h.provider.requests.length,0);assert.ok(!JSON.stringify(after).includes('never-export-me'));
    const bytes=await h.invoke('get',`/gallery/${target.id}/image/${face.id}`);assert.equal(bytes.data.toString('base64'),DATA.split(',')[1]);
    assert.equal((await h.invoke('post',`/gallery/${target.id}/import`,{token:preview.token})).code,400);
});
test('truncated, corrupt or foreign backup streams are rejected without changing galleries',async t=>{
    const {h,g,root}=await setup(t);await upload(h,g);const directory=path.join(root,'character-gallery-studio');
    const gallery=await read(h,g),records=[];for await(const line of backupRecords(gallery,path.join(directory,g.id))) records.push(line);
    await assert.rejects(stageBackup(Readable.from([gzipSync(records.slice(0,-1).join(''))]),directory,imageBytes),/incomplete/);
    await assert.rejects(stageBackup(Readable.from([gzipSync('{"kind":"header","format":"wrong"}\n')]),directory,imageBytes),/supported/);
    const corrupt=records.join('').replace(gallery.images[0].sha256,'0'.repeat(64));await assert.rejects(stageBackup(Readable.from([gzipSync(corrupt)]),directory,imageBytes),/integrity/);
    assert.equal((await read(h,g)).images.length,1);assert.deepEqual(await fs.readdir(path.join(directory,'.imports')),[]);
});
test('import staging and gallery relinks remain isolated by user; aliases preserve old galleries',async t=>{
    const {h,g,root}=await setup(t),a=await upload(h,g); const b=(await h.invoke('post','/gallery/open',{avatar:'Bob.png',name:'Bob'})).data;
    assert.equal((await h.invoke('post','/gallery/relink',{avatar:'Bob.png',sourceId:g.id})).code,400);
    await h.invoke('post','/gallery/relink',{avatar:'Bob.png',sourceId:g.id,confirm:true});
    const reopened=(await harness(root).invoke('post','/gallery/open',{avatar:'Bob.png',name:'Bob'})).data;assert.equal(reopened.id,g.id);assert.equal(reopened.images[0].id,a.id);
    assert.equal((await read(h,b)).id,b.id);
    const other=await fs.mkdtemp(path.join(os.tmpdir(),'cgs-other-'));t.after(()=>fs.rm(other,{recursive:true,force:true}));
    assert.equal((await h.invoke('post','/gallery/relink',{avatar:'Bob.png',sourceId:g.id,confirm:true},other)).code,404);
    const preview=await stageBackup(Readable.from([await packed(root,await read(h,g))]),path.join(root,'character-gallery-studio'),imageBytes);
    assert.equal((await h.invoke('post',`/gallery/${g.id}/import`,{token:preview.token},other)).code,400);
    await h.invoke('post','/gallery/unlink',{avatar:'Bob.png',confirm:true}); assert.equal((await h.invoke('post','/gallery/open',{avatar:'Bob.png'})).data.id,b.id);
});
test('streamed gzip export has a verified end record and reimports',async t=>{
    const {h,g,root}=await setup(t);await upload(h,g);const gallery=await read(h,g);const out=new PassThrough(),parts=[];out.on('data',b=>parts.push(b));
    await streamBackup(gallery,path.join(root,'character-gallery-studio',g.id),out);
    const result=await stageBackup(Readable.from(parts),path.join(root,'character-gallery-studio'),imageBytes);assert.equal(result.summary.images,1);
});
