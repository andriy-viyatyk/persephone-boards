import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { logMel } from './frontend.mjs';
const prototype = 'C:/projects/test-boards/wake-enroll-test';
const ort = createRequire(prototype + '/package.json')('onnxruntime-node');
const opts = { intraOpNumThreads: 1, interOpNumThreads: 1 };
const mel = await ort.InferenceSession.create(prototype + '/model/melspectrogram.onnx',opts);
const reference = await ort.InferenceSession.create(prototype + '/model/embedding_model.onnx',opts);
const clean = await ort.InferenceSession.create('_test/wake-export/speech-embedding.onnx',opts);
function wav(file) {
 const b=readFileSync(file); let fmt, data; for(let i=12;i+8<=b.length;) {const id=b.toString('ascii',i,i+4), n=b.readUInt32LE(i+4), p=i+8; if(id==='fmt ') fmt={type:b.readUInt16LE(p),ch:b.readUInt16LE(p+2),rate:b.readUInt32LE(p+4),bits:b.readUInt16LE(p+14)}; if(id==='data') data=b.subarray(p,p+n); i=p+n+(n&1);}
 if(fmt.type!==1||fmt.ch!==1||fmt.rate!==16000||fmt.bits!==16) throw Error(JSON.stringify(fmt));
 return Float32Array.from({length:data.length/2},(_,i)=>data.readInt16LE(i*2)/32767);
}
function norm(a) {let s=0;for(const x of a)s+=x*x;s=Math.sqrt(s)+1e-9;return Float32Array.from(a,x=>x/s);}
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
async function embed(audio) {
 const a=Float32Array.from(audio,x=>x*32767);
 const mo=(await mel.run({input:new ort.Tensor('float32',a,[1,12800])})).output;
 const last=new Float32Array(76*32); for(let i=0;i<last.length;i++) last[i]=mo.data[(mo.dims[2]-76)*32+i]/10+2;
 const ref=norm((await reference.run({input_1:new ort.Tensor('float32',last,[1,76,32,1])})).conv2d_19.data);
 const features=logMel(audio).slice(0,76*32);
 const out=await clean.run({[clean.inputNames[0]]:new ort.Tensor('float32',features,[1,76,32])});
 return [ref,norm(out[clean.outputNames[0]].data)];
}
function dtw(a,b) {let d=Array(b.length).fill(0),n=Array(b.length).fill(1); for(let j=0;j<b.length;j++)d[j]=1-dot(a[0],b[j]); for(let i=1;i<a.length;i++){const D=[],N=[];for(let j=0;j<b.length;j++){let v=d[j],s=n[j];if(j&&d[j-1]<v){v=d[j-1];s=n[j-1];}if(j&&D[j-1]<v&&N[j-1]<2*a.length){v=D[j-1];s=N[j-1];}D[j]=v+1-dot(a[i],b[j]);N[j]=s+1;}d=D;n=N;}return d.at(-1)/n.at(-1);}
function best(a,b){if(b.length<a.length)b=[...b,...Array(a.length-b.length).fill(b.at(-1))];let v=Infinity;for(let end=a.length;end<=b.length;end++)v=Math.min(v,dtw(a,b.slice(Math.max(0,end-2*a.length-4),end)));return v;}
function trim(emb,levels){const loudest=Math.max(...levels),floor=[...levels].sort((a,b)=>a-b)[Math.floor(levels.length*.2)],limit=Math.max(loudest-22,floor+8,-50),speech=levels.map(v=>v>limit),peak=levels.indexOf(loudest);let first=peak,last=peak;for(let i=peak-1,g=0;i>=0;i--){if(speech[i]){first=i;g=0;}else if(++g>3)break;}for(let i=peak+1,g=0;i<levels.length;i++){if(speech[i]){last=i;g=0;}else if(++g>3)break;}return emb.slice(Math.min(emb.length-1,first+3),Math.min(emb.length,last+5));}
const files=readdirSync(prototype+'/enroll').filter(x=>x.endsWith('.wav')).sort();
const samples=[];let cos=[];
for(const file of files){const pcm=wav(prototype+'/enroll/'+file), padded=new Float32Array(12800+pcm.length);padded.set(pcm,12800);const pairs=[],levels=[];for(let end=14080;end<=padded.length;end+=1280){const chunk=padded.subarray(end-1280,end);levels.push(10*Math.log10(chunk.reduce((s,x)=>s+x*x,0)/chunk.length+1e-12));const pair=await embed(padded.subarray(end-12800,end));pairs.push(pair);cos.push(dot(...pair));} samples.push([trim(pairs.map(x=>x[0]),levels),trim(pairs.map(x=>x[1]),levels)]);}
console.log('clips',files.length,'frames',cos.length,'embedding cosine min/mean/max',Math.min(...cos),cos.reduce((a,b)=>a+b,0)/cos.length,Math.max(...cos));
for(let i=0;i<samples.length;i++)for(let j=i+1;j<samples.length;j++) console.log('pair',i+1,j+1,'ref',best(samples[i][0],samples[j][0]),'clean',best(samples[i][1],samples[j][1]));

for (const kind of ['silence','tone','noise']) {
 const pcm=new Float32Array(40000);let state=1234567;for(let i=0;i<pcm.length;i++){state=(1664525*state+1013904223)>>>0;pcm[i]=kind==='tone'?0.1*Math.sin(2*Math.PI*440*i/16000):kind==='noise'?0.05*(state/2147483648-1):0;}
 const padded=new Float32Array(12800+pcm.length);padded.set(pcm,12800);const a=[[],[]];for(let end=14080;end<=padded.length;end+=1280){let pair=await embed(padded.subarray(end-12800,end));a[0].push(pair[0]);a[1].push(pair[1]);}
 const r=Math.min(...samples.map(x=>best(x[0],a[0]))), c=Math.min(...samples.map(x=>best(x[1],a[1])));console.log('synthetic',kind,'ref',r,'clean',c,'hits <=0.15',r<=0.15,c<=0.15);
}
