(function(e,t){typeof exports==`object`&&typeof module<`u`?t(exports):typeof define==`function`&&define.amd?define([`exports`],t):(e=typeof globalThis<`u`?globalThis:e||self,t(e.AVGrid={}))})(this,function(e){Object.defineProperty(e,Symbol.toStringTag,{value:`Module`});var t=e=>e==null,n=(e,t)=>e<=t?Array.from({length:t-e+1},(t,n)=>e+n):Array.from({length:e-t+1},(e,n)=>t+n);function r(e,t,n){let r=null,i=(...i)=>{let a=()=>{if(!n||n()){e(...i);return}r=setTimeout(a,t)};r&&clearTimeout(r),r=setTimeout(a,t)};return i.cancel=()=>{r&&clearTimeout(r),r=null},i}var i=(e,t)=>{let n=new Map,r=((...r)=>{let i=JSON.stringify(r);if(n.has(i))return n.get(i);let a=e(...r),o=!t||t(a);return o instanceof Promise?o.then(e=>{e&&n.set(i,a)}):o&&n.set(i,a),a});return Object.defineProperty(r,"length",{get:()=>e.length}),r.clear=()=>n.clear(),r},a=`"`;function o(e){if(e==null)return``;if(typeof e==`string`)return e;if(typeof e==`boolean`)return e?`true`:`false`;if(typeof e==`number`)return Number.isFinite(e)?String(e):``;if(e instanceof Date)return e.toISOString();if(typeof e==`object`)try{return JSON.stringify(e)}catch{return String(e)}return String(e)}function s(e,t,n){return e.includes(a)||e.includes(t)||e.includes(`\r`)||e.includes(`
`)||n.length>0&&e.includes(n)?a+e.split(a).join(`""`)+a:e}function c(e,t,n={}){let{header:r=!0,headerNames:i,delimiter:a=`,`,rowDelimiter:c=`
`}=n,l=t.map(e=>e===void 0?`undefined`:e),u=[];if(r){let e=(i??l).map(e=>e===void 0?`undefined`:e);u.push(e.map(e=>s(e,a,c)).join(a))}for(let t of e){let e=t??{};u.push(l.map(t=>s(o(e[t]),a,c)).join(a))}return u.length?u.join(c)+c:``}function l(e,t){let n=[],r=[],i=``,o=!1,s=!1,c=()=>{r.push(i),i=``,s=!1},l=()=>{c(),(r.length!==1||r[0]!==``)&&n.push(r),r=[]},u=0;for(;u<e.length;){let n=e[u];if(o){if(n===a){if(e[u+1]===a){i+=a,u+=2;continue}o=!1,u+=1;continue}i+=n,u+=1;continue}if(n===a&&!s){o=!0,s=!0,u+=1;continue}if(t.length>0&&e.startsWith(t,u)){c(),u+=t.length;continue}if(n===`\r`){l(),u+=e[u+1]===`
`?2:1;continue}if(n===`
`){l(),u+=1;continue}i+=n,s=!0,u+=1}return l(),n}function u(e,t=!1,n=`	`,r){try{if(!e?.trim())return[];let r=l(e,n);if(!t)return r;let[i,...a]=r;return i?a.map(e=>{let t={};return i.forEach((n,r)=>{t[n]=e[r]??``}),t}):[]}catch(e){return console.error(e),r?.(e),[]}}var d=i(e=>(n,r)=>{let i=e?n[e]:n,a=e?r[e]:r;return t(i)===t(a)?typeof i==`number`&&typeof a==`number`?i-a:typeof i==`string`&&typeof a==`string`?i.localeCompare(a):i instanceof Date&&a instanceof Date?i.getTime()-a.getTime():typeof i==`boolean`&&typeof a==`boolean`?i===a?0:i?1:-1:0:t(i)?-1:1});function f(e,n=`text`){if(t(e))return``;switch(n){case`text`:if(e instanceof Date)return e.toLocaleString();if(e||typeof e==`boolean`)return e.toString();break;case`date`:case`dateTime`:if(e instanceof Date)return n===`date`?e.toLocaleDateString():e.toLocaleString();if(typeof e==`string`){let t=new Date(e);return Number.isNaN(t.getTime())?``:n===`date`?t.toLocaleDateString():t.toLocaleString()}break;case`phone`:if(typeof e==`string`)return e.length===10?`(${e.substring(0,3)}) ${e.substring(3,6)}-${e.substring(6)}`:e}return``}function p(e,t){let{filter:n,column:r}=t;return r?.formatValue?r.formatValue(r,e):e[n.columnKey]}function m(e,t){let n=typeof e==`object`&&e&&!(e instanceof Date)&&`value`in e?e.value:e;return t instanceof Date&&n instanceof Date?n.getTime()===t.getTime():n===t}function h(e,t){let n=!0;if(t?.length)for(let r of t){let t=r.filter,i=r.column,a=i?.filter;if(a){let r=t.value;if(r!=null&&!a.match(r,e,i)&&(n=!1),!n)break;continue}let o=p(e,r);switch(t.type??`options`){case`options`:{let e=t;e.value?.length&&(e.value.some(e=>m(e,o))||(n=!1));break}}if(!n)break}return n}function g(e,t,n){return!n||t.some(t=>{let r=D(t,e)?.toString().toLowerCase();return!!r&&r.indexOf(n)>=0})}var _=[];function v(e){if(!e)return _;let t=e.toLowerCase().split(/\s+/).filter(Boolean);return t.length?t:_}function y(e,t,n,r){if(!n?.length&&!r?.length)return e;let i=v(n),a=r?.length?r.map(e=>({filter:e,column:t.find(t=>String(t.key)===e.columnKey)})):void 0;return e.filter(e=>e?(!i.length||i.every(n=>g(e,t,n)))&&(!a?.length||h(e,a)):!1)}function b(e){return!!(e&&typeof e==`string`&&(e.toLowerCase()===`false`||e.toLowerCase()===`no`))}function x(e){return!!(e&&!b(e))}function ee(e){let t=[],n=new Map;for(let r of e){let e=r.group;if(e===void 0)t.push([r]);else{let i=n.get(e);if(i)i.push(r);else{let i=[r];n.set(e,i),t.push(i)}}}let r=t.flat();return r.some((t,n)=>t!==e[n])?r:e}function S(e){return e===void 0?C:Array.isArray(e)?e:[e]}var C=[];function w(e,t){let n=S(e),r=S(t);return n.length===r.length&&n.every((e,t)=>e.key===r[t].key&&e.direction===r[t].direction)}function T(e){return e.isStatusColumn===!0||e.pinned===`left`}function E(e){let t=0;for(let n=e.length-1;n>=0&&e[n].pinned===`right`;n--)t++;return t}function D(e,t){return e.formatValue?e.formatValue(e,t):e.displayFormat?f(t[e.key],e.displayFormat):t[e.key]}function te(e,t,n,r){if(!e?.length||!t?.length)return;let i=t.map(e=>e.name??String(e.key)),a=t.map((e,t)=>String(t));return c(e.map(e=>t.reduce((t,n,r)=>(t[a[r]]=D(n,e),t),{})),a,{header:n,headerNames:i,delimiter:r===!0?`	`:r})}function O(e,t,n){switch(e.dataType){case`boolean`:return typeof n==`string`&&(n.toLowerCase()===`false`||n.toLowerCase()===`no`||n.toLowerCase()===`0`)?!1:!!n;case`number`:{let e=Number(n);return isNaN(e)?null:e}default:return n&&Array.isArray(e.options)?e.options.find(e=>e===n)?n:void 0:n}}var k=(e,t)=>Array.from({length:t-e+1},(t,n)=>e+n),A=(e,t)=>k(0,t.stickyLeft-1).forEach(t=>{e.columns[t]=!0}),ne=(e,t)=>k(t.columnCount-t.stickyRight,t.columnCount-1).forEach(t=>{e.columns[t]=!0}),re=(e,t)=>k(0,t.stickyTop-1).forEach(t=>{e.rows[t]=!0}),ie=(e,t)=>k(1,t.stickyBottom).forEach(n=>{e.rows[t.rowCount-n]=!0}),ae=(e,t,n)=>k(Math.min(t.input.stickyTop,n.stickyTop)+1,Math.max(t.input.stickyTop,n.stickyTop)).forEach(t=>{e.rows[t-1]=!0}),oe=(e,t,n)=>k(1,Math.max(t.input.stickyBottom,n.stickyBottom)).forEach(t=>{e.rows[n.rowCount-t]=!0}),se=(e,t,n)=>k(Math.min(t.input.stickyLeft,n.stickyLeft)+1,Math.max(t.input.stickyLeft,n.stickyLeft)).forEach(t=>{e.columns[t-1]=!0}),ce=(e,t,n)=>k(1,Math.max(t.input.stickyRight,n.stickyRight)).forEach(t=>{e.columns[n.columnCount-t]=!0});function le(e,t,n){k(t.rendered.left,t.rendered.right).forEach(t=>{e.columns[t]=!0}),A(e,n),ne(e,n)}function ue(e,t,n){for(let n=t.rendered.top;n<=t.rendered.bottom;n++)e.rows[n]=!0;re(e,n),ie(e,n)}function de(e,t,n){if(typeof t.columnLength==`number`)throw Error(`markDirtyWidth requires old.columnLength to be an array, not a number`);let r=!1,i=t.columnLength.findIndex((e,t)=>e!==n[t]);return i<0?!1:(i<=t.rendered.right&&(k(Math.max(i,t.rendered.left),t.rendered.right).forEach(t=>{e.columns[t]=!0}),r=!0),i<t.input.stickyLeft&&(A(e,t.input),r=!0),t.input.stickyRight&&i<=t.input.columnCount-t.input.stickyRight&&(ne(e,t.input),r=!0),r)}function fe(e,t,n){if(typeof t.rowLength==`number`)throw Error(`markDirtyHeight requires old.rowLength to be an array, not a number`);let r=!1,i=t.rowLength.findIndex((e,t)=>e!==n[t]);return i<0?!1:(i<t.rendered.bottom&&(k(Math.max(i,t.rendered.top),t.rendered.bottom).forEach(t=>{e.rows[t]=!0}),r=!0),i<t.input.stickyTop&&(re(e,t.input),r=!0),t.input.stickyBottom&&i<=t.input.rowCount-t.input.stickyBottom&&(ie(e,t.input),r=!0),r)}function pe(e,t,n,r,i,a=n.fitToWidth){let o,s;if(!e)o={all:!1,rows:{},columns:{},cells:{}},s=!0;else{let n=e=>e>=t.rendered.top&&e<=t.rendered.bottom||e<t.input.stickyTop||e>=t.input.rowCount-t.input.stickyBottom,r=e=>e>=t.rendered.left&&e<=t.rendered.right||e<t.input.stickyLeft||e>=t.input.columnCount-t.input.stickyRight,i=(e.rows||[]).filter(n);if(e.fromRow!==void 0){for(let n=Math.max(e.fromRow,t.rendered.top);n<=t.rendered.bottom;n++)i.push(n);for(let n=Math.max(e.fromRow,t.input.rowCount-t.input.stickyBottom);n<t.input.rowCount;n++)i.push(n)}let a=(e.columns||[]).filter(r),c=(e.cells||[]).filter(({row:e,col:t})=>n(e)&&r(t));s=!(i.length||a.length||c.length),o={all:e.all??!1,rows:i.reduce((e,t)=>(e[t]=!0,e),{}),columns:a.reduce((e,t)=>(e[t]=!0,e),{}),cells:c.reduce((e,{row:t,col:n})=>(e[`${t}_${n}`]=!0,e),{})}}return a&&(t.input.scrollBarWidth!==n.scrollBarWidth||t.input.size.width!==n.size.width)&&(o.all=!0),o.all?o:(t.input.stickyTop!==n.stickyTop&&(ae(o,t,n),A(o,n),ne(o,n),s=!1),t.input.stickyBottom!==n.stickyBottom&&(oe(o,t,n),s=!1),t.input.stickyLeft!==n.stickyLeft&&(se(o,t,n),s=!1),t.input.stickyRight!==n.stickyRight&&(ce(o,t,n),s=!1),t.input.rowCount!==n.rowCount&&(ie(o,t.input),ie(o,n),s=!1),t.input.columnCount!==n.columnCount&&(ne(o,t.input),ne(o,n),s=!1),typeof t.columnLength==`number`==(typeof r==`number`)?typeof r==`number`?t.columnLength!==r&&(le(o,t,n),s=!1):de(o,t,r)&&(s=!1):(le(o,t,n),s=!1),typeof t.rowLength==`number`==(typeof i==`number`)?typeof i==`number`?t.rowLength!==i&&(ue(o,t,n),s=!1):fe(o,t,i)&&(s=!1):(ue(o,t,n),s=!1),s?null:o)}var me={visible:{top:0,right:0,bottom:0,left:0},rendered:{top:0,right:0,bottom:0,left:0},visibleOffset:{top:0,right:0,bottom:0,left:0},innerSize:{width:0,height:0,stickyTopHeight:0,stickyRightWidth:0,stickyBottomHeight:0,stickyLeftWidth:0},columnLength:[],rowLength:[],columnStarts:[],rowStarts:[],input:{size:{width:0,height:0},rowCount:0,columnCount:0,stickyTop:0,stickyRight:0,stickyBottom:0,stickyLeft:0,scrollBarWidth:0,scrollBarHeight:0,fitToWidth:!1},cells:[],stickyTop:[],stickyLeft:[],stickyRight:[],stickyBottom:[],stickyTopLeft:[],stickyTopRight:[],stickyBottomRight:[],stickyBottomLeft:[],map:{},renderRange:{rows:[],columns:[]}},he=20;function ge(e){return Number(e.substring(0,e.length-1))}function _e(e,t){let n=e.reduce((e,t)=>e+(typeof t==`number`?t:0),0),r=e.reduce((e,t)=>e+(typeof t==`string`?ge(t):0),0),i=e.reduce((e,t,n)=>typeof t==`string`?n:e,-1),a=Math.max(0,t-n),o=r>0?a/r:0;return e.map((e,t)=>{if(typeof e==`string`){if(t===i)return a;let n=Math.trunc(ge(e)*o);return a=Math.max(0,a-n),n}return e})}function ve(e,t,n=!1,r=0){if(typeof t==`number`)return t;let i=Array.from({length:e},(e,n)=>t(n));return Array.isArray(i)&&(n||i.some(e=>typeof e==`string`))?_e(i,r):i}function ye(e,t){if(typeof t==`number`)return!1;for(let n=0;n<e;n++)if(typeof t(n)==`string`)return!0;return!1}function be(e){if(typeof e==`number`)return e;let t=[...e];return t.forEach((n,r)=>{t[r]=r===0?0:t[r-1]+e[r-1]}),t}function j(e,t,n=1){if(typeof e==`number`)return n*e;let r=0;for(let i=t;i<t+n;i++)r+=e[i];return r}function xe(e,t){return typeof e==`number`?e:e[t]}function M(e,t){return typeof e==`number`?t*e:e[t]}function Se(e,t,n=!0){if(typeof e==`number`)return Math.trunc(t/e);let r=n?e.length-1:-1,i=0;for(let n=0;n<e.length;n++)if(i+=e[n],i>t){r=n;break}return r}var Ce=(e,t,n,r,i,a,o,s,c,l,u)=>({width:j(o,0,t)+(r||c?0:u??20),height:j(s,0,e)+(i?l??0:l??20),stickyTopHeight:j(s,0,n),stickyRightWidth:j(o,t-r,r),stickyBottomHeight:j(s,e-i,i),stickyLeftWidth:j(o,0,a)});function we(e,t,n,r,i,a,o,s,c,l,u,d,f,p){let m=Se(l,a.x+e.stickyLeftWidth),h=Se(l,a.x+r-d);m=Math.max(0,m),h=Math.min(h,n-1);let g=Se(u,a.y+e.stickyTopHeight),_=Se(u,a.y+i-e.stickyBottomHeight-f);g=Math.max(0,g),_=Math.min(_,t-1);let v={top:c.y<0?Math.max(0,g-s):g,right:c.x>0?Math.min(n-1,h+o):h,bottom:c.y>0?Math.min(t-1,_+s):_,left:c.x<0?Math.max(0,m-o):m};return p&&p(v),{visible:{top:g,right:h,bottom:_,left:m},rendered:v}}var Te=(e,t,n,r,i,a,o,s,c)=>({left:M(i,e.left)-o.stickyLeftWidth,right:j(n,0,e.right+1)-(a.width-o.stickyRightWidth-s),top:M(r,e.top)-o.stickyTopHeight,bottom:j(t,0,e.bottom+1)-(a.height-o.stickyBottomHeight-c)}),N=(e,t,n,r=0,i=0)=>{let{renderCell:a,recycle:o,setReuseKey:s,old:c,newInfo:l,rerender:u,rowLength:d,columnLength:f,rowStarts:p,columnStarts:m}=e,h=`${t}_${n}`,g=c.map[h],_=g;return(!_||u&&(u.all||u.cells[h]||u.columns[n]||u.rows[t]))&&(_=a?.({col:n,row:t,style:{display:`inline-flex`,position:`absolute`,left:i?j(f,i,n-i):M(m,n),width:xe(f,n),top:r?j(d,r,t-r):M(p,t),height:xe(d,t)},key:h,renderInfo:l,recycle:o,setReuseKey:s,previous:g})),l.map[h]=_,l.renderRange.rows.indexOf(t)<0&&l.renderRange.rows.push(t),l.renderRange.columns.indexOf(n)<0&&l.renderRange.columns.push(n),_};function Ee(e,t,n,r){let{offset:i,size:a,rowCount:o,columnCount:s,rowHeight:c,columnWidth:l,renderCell:u,stickyTop:d=0,stickyLeft:f=0,stickyRight:p=0,stickyBottom:m=0,overscanColumn:h,overscanRow:g,scrollBarWidth:_,scrollBarHeight:v,direction:y={x:0,y:0},fitToWidth:b,onAdjustRenderRange:x}=t,{rerender:ee}=t;if(!ee&&(y.x||y.y)&&e.visibleOffset&&i.x>=e.visibleOffset.left&&i.x<=e.visibleOffset.right&&i.y>=e.visibleOffset.top&&i.y<=e.visibleOffset.bottom)return e;let S=b||ye(s,l),C=ve(s,l,b,a.width-_),w=ve(o,c),T=Ce(o,s,d,p,m,f,C,w,S,n,r),E=we(T,o,s,a.width,a.height,i,h,g,y,C,w,_,v,x),D;if(e.rendered.top||e.rendered.bottom){if(D=pe(ee,e,t,C,w,S),!ee&&E.visible.left>=e.visible.left&&E.visible.right<=e.visible.right&&E.visible.top>=e.visible.top&&E.visible.bottom<=e.visible.bottom&&T.width===e.innerSize.width&&T.height===e.innerSize.height&&T.stickyTopHeight===e.innerSize.stickyTopHeight&&T.stickyRightWidth===e.innerSize.stickyRightWidth&&T.stickyBottomHeight===e.innerSize.stickyBottomHeight&&T.stickyLeftWidth===e.innerSize.stickyLeftWidth)return e}else D={all:!0,cells:{},columns:{},rows:{}};let te=be(C),O=be(w);E.visibleOffset=Te(E.visible,w,C,O,te,a,T,_,v);let k={...E,innerSize:T,columnLength:C,rowLength:w,columnStarts:te,rowStarts:O,input:{size:a,rowCount:o,columnCount:s,stickyTop:d,stickyRight:p,stickyBottom:m,stickyLeft:f,scrollBarWidth:_,scrollBarHeight:v,fitToWidth:b},cells:[],stickyTop:[],stickyLeft:[],stickyRight:[],stickyBottom:[],stickyTopLeft:[],stickyTopRight:[],stickyBottomRight:[],stickyBottomLeft:[],map:{},renderRange:{rows:[],columns:[]}},A={renderCell:u,recycle:t.recycle,setReuseKey:t.setReuseKey,old:e,newInfo:k,rerender:D,rowLength:w,columnLength:C,rowStarts:O,columnStarts:te};for(let e=k.rendered.top;e<=k.rendered.bottom;e++)for(let t=k.rendered.left;t<=k.rendered.right;t++)e<d||t<f||e>=o-m||t>=s-p||k.cells.push(N(A,e,t));for(let e=0;e<d;e++){for(let t=0;t<f;t++)k.stickyTopLeft.push(N(A,e,t));for(let t=Math.max(f,k.rendered.left);t<=Math.min(k.rendered.right,s-p-1);t++)k.stickyTop.push(N(A,e,t));for(let t=s-p;t<s;t++)k.stickyTopRight.push(N(A,e,t,0,s-p))}for(let e=o-m;e<o;e++){for(let t=0;t<f;t++)k.stickyBottomLeft.push(N(A,e,t,o-m,0));for(let t=Math.max(f,k.rendered.left);t<=Math.min(k.rendered.right,s-p-1);t++)k.stickyBottom.push(N(A,e,t,o-m,0));for(let t=s-p;t<s;t++)k.stickyBottomRight.push(N(A,e,t,o-m,s-p))}for(let e=Math.max(d,k.rendered.top);e<=Math.min(k.rendered.bottom,o-m-1);e++){for(let t=0;t<f;t++)k.stickyLeft.push(N(A,e,t,d,0));for(let t=s-p;t<s;t++)k.stickyRight.push(N(A,e,t,d,s-p))}return k}function De(e,t,n){let r={left:M(t.columnStarts,e),right:j(t.columnLength,0,e+1)},i=t.input.size,a={...n},o=i.width-t.innerSize.stickyRightWidth-t.input.scrollBarWidth;return a.x+o<r.right?a.x=r.right-o:a.x>r.left-t.innerSize.stickyLeftWidth&&(a.x=r.left-t.innerSize.stickyLeftWidth),a}function Oe(e,t,n,r=`nearest`){let i={top:M(t.rowStarts,e),bottom:j(t.rowLength,0,e+1)},a=t.input.size,o={...n};if(e>=t.input.rowCount-1)return o.y=t.innerSize.height-t.input.size.height+t.input.scrollBarHeight,o;let s=a.height-t.innerSize.stickyBottomHeight-t.input.scrollBarHeight;return r===`nearest`?o.y+s<i.bottom?o.y=i.bottom-s:o.y>i.top-t.innerSize.stickyTopHeight&&(o.y=i.top-t.innerSize.stickyTopHeight):r===`top`?o.y=i.top-t.innerSize.stickyTopHeight:r===`bottom`?o.y=i.bottom-s:r===`center`&&(o.y=i.top-t.innerSize.stickyTopHeight+(i.bottom-i.top-s)/2,o.y+s<i.bottom?o.y=i.bottom-s:o.y>i.top&&(o.y=i.top-t.innerSize.stickyTopHeight)),o}function ke(e,t,n,r){return Oe(e,n,De(t,n,r))}function P(e,t){if(!t)return e;if(typeof t==`string`)return`${e} ${t}`;let n=e;for(let e of t)e&&(n+=` ${e}`);return n}function Ae(e,t){let n=e.firstChild;if(n&&n.nodeType===3)for(n.nodeValue!==t&&(n.nodeValue=t);n.nextSibling;)e.removeChild(n.nextSibling);else e.textContent=``,e.appendChild(document.createTextNode(t))}function F(e,t){let n=e.style,r=`${t.left}px`;n.left!==r&&(n.left=r);let i=`${t.top}px`;n.top!==i&&(n.top=i);let a=`${t.width}px`;n.width!==a&&(n.width=a);let o=`${t.height}px`;n.height!==o&&(n.height=o)}var je=e=>`${e}px`;function I(e,t,n){e.style.getPropertyValue(t)!==n&&e.style.setProperty(t,n)}var Me=class{model;render;band;cells=new Map;contentDirty=!0;unsubscribeRender;dataHandle;constructor(e,t){this.model=e,this.render=t,this.unsubscribeRender=t.model.state.subscribe(this.sync),this.dataHandle=e.data.onChange.subscribe(e=>{e.columns&&(this.contentDirty=!0)})}markDirty=()=>{this.contentDirty=!0,this.sync()};sync=()=>{let e=this.model.data;if(!e.hasGroups){this.band&&(this.band.remove(),this.band=void 0,this.cells.clear());return}let t=e.columns,n=this.render.model.renderInfo.current;if(typeof n.columnStarts!=`number`&&n.columnStarts.length<t.length)return;if(!this.band){let e=document.createElement(`div`);e.className=`avg-group-row`,e.setAttribute(`data-type`,`group-row`),e.setAttribute(`aria-hidden`,`true`),e.style.position=`absolute`,e.style.left=`0`,e.style.top=`0`,this.render.addOverlay(e,`header`),this.band=e,this.contentDirty=!0}let r=this.model.options.rowHeight,i=new Set,a=0;for(;a<t.length;){let e=t[a].group;if(e===void 0){a++;continue}let o=a;for(;o+1<t.length&&t[o+1].group===e;)o++;let s=`${a}:${e}`;i.add(s);let c=this.cells.get(s),l=!1;c||(c=document.createElement(`div`),c.setAttribute(`data-type`,`group-cell`),this.band.append(c),this.cells.set(s,c),l=!0);let u=M(n.columnStarts,a),d=0;for(let e=a;e<=o;e++)d+=xe(n.columnLength,e);if(I(c,`position`,`absolute`),I(c,`left`,je(u)),I(c,`top`,`0`),I(c,`width`,je(d)),I(c,`height`,je(r)),l||this.contentDirty){let n={group:e,columns:t.slice(a,o+1)};c.setAttribute(`data-group`,e),c.className=P(`avg-group-cell`,this.model.options.columnGroupClass?.(n));let r=this.model.options.columnGroupRender?.(n);r==null?(c.textContent=e,c.title=e):typeof r==`string`?(c.innerHTML=r,c.removeAttribute(`title`)):(c.textContent=``,c.appendChild(r),c.removeAttribute(`title`))}a=o+1}for(let[e,t]of this.cells)i.has(e)||(t.remove(),this.cells.delete(e));this.contentDirty=!1};destroy=()=>{this.unsubscribeRender(),this.dataHandle.unsubscribe(),this.band?.remove(),this.band=void 0,this.cells.clear()}};function Ne(e,t){return typeof e==`function`?e(t):e}var Pe=class{_state;_defaultState;_listeners=[];_notifyScheduled=!1;_batchDepth=0;_disposed=!1;constructor(e){this._defaultState=e,this._state=e}get state(){return this._state}get(){return this._state}set=e=>{if(this._disposed)return;let t=Ne(e,this._state);t!==this._state&&(this._state=t,this.notify())};update=e=>{if(this._disposed)return;let t={...this._state};e(t),this._state=t,this.notify()};clear=()=>{this.set(this._defaultState)};subscribe=e=>{this._listeners.push(e);let t=!0;return()=>{if(!t)return;t=!1;let n=this._listeners.indexOf(e);n>=0&&this._listeners.splice(n,1)}};batch=e=>{this._batchDepth++;try{return e()}finally{this._batchDepth--,this._batchDepth===0&&this._notifyScheduled&&this.flush()}};flush=()=>{if(!this._notifyScheduled||this._batchDepth>0||(this._notifyScheduled=!1,this._disposed))return;let e=this._listeners.slice();for(let t of e)t(this._state)};dispose=()=>{this._disposed=!0,this._notifyScheduled=!1,this._listeners=[]};get disposed(){return this._disposed}notify(){this._notifyScheduled||(this._notifyScheduled=!0,!(this._batchDepth>0)&&queueMicrotask(()=>this.flush()))}},Fe=class{state;constructor(e){this.state=new Pe(e)}dispose(){this.state.dispose()}},Ie=`<span class="avg-search-match">`,Le=`<span class="avg-cell-text">`,Re=`</span>`;function L(e){return e.indexOf(`&`)<0&&e.indexOf(`<`)<0&&e.indexOf(`>`)<0?e:e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`)}function ze(e,t){return(t.length?He(e,t):null)??L(e)}function Be(e,t){return ze(e==null?``:String(e),v(t))}function Ve(e,t,n){return Ie+L(e.slice(t,n))+Re}function He(e,t){if(!e)return null;let n=e.toLowerCase(),r=null;for(let e of t){if(!e)continue;let t=n.indexOf(e);for(;t>=0;)(r??=[]).push([t,t+e.length]),t=n.indexOf(e,t+e.length)}if(!r)return null;r.length>1&&r.sort((e,t)=>e[0]-t[0]);let i=``,a=0,o=-1,s=-1;for(let t of r){if(t[0]<=s){t[1]>s&&(s=t[1]);continue}o>=0&&(i+=L(e.slice(a,o))+Ve(e,o,s),a=s),o=t[0],s=t[1]}return i+=L(e.slice(a,o))+Ve(e,o,s),i+=L(e.slice(s)),Le+i+Re}var R=class{listeners=[];send=e=>{let t=this.listeners.slice();for(let n of t)n(e)};subscribe=e=>{this.listeners.push(e);let t=!0;return{unsubscribe:()=>{if(!t)return;t=!1;let n=this.listeners.indexOf(e);n>=0&&this.listeners.splice(n,1)}}};clear=()=>{this.listeners=[]};get listenerCount(){return this.listeners.length}},Ue={rows:!1,columns:!1,lastIsStatusIndex:!1,stickyRightCount:!1,hasGroups:!1,rowCompare:!1,allSelected:!1,hovered:!1,editTime:!1,rowsFrozen:!1,newRowKey:!1},We=class{onChange=new R;_changeEvent={...Ue};_rows;_columns;_lastIsStatusIndex=-1;_stickyRightCount=0;_hasGroups=!1;_rowCompare;_sortValue;_allSelected=!1;_hovered={row:-1,col:-1};_editTime=0;_rowsFrozen=!1;_newRowKey;searchWords=[];constructor(e,t){this._rows=e,this._columns=t}change=e=>{let t={...e,...this._changeEvent};(e||Object.getOwnPropertyNames(t).some(e=>t[e]))&&(this._changeEvent={...Ue},this.onChange.send(t))};get rows(){return this._rows}set rows(e){this._rows!==e&&(this._rows=e,this._changeEvent.rows=!0)}get columns(){return this._columns}set columns(e){this._columns!==e&&(this._columns=e,this._changeEvent.columns=!0)}get lastIsStatusIndex(){return this._lastIsStatusIndex}set lastIsStatusIndex(e){this._lastIsStatusIndex!==e&&(this._lastIsStatusIndex=e,this._changeEvent.lastIsStatusIndex=!0)}get stickyRightCount(){return this._stickyRightCount}set stickyRightCount(e){this._stickyRightCount!==e&&(this._stickyRightCount=e,this._changeEvent.stickyRightCount=!0)}get hasGroups(){return this._hasGroups}set hasGroups(e){this._hasGroups!==e&&(this._hasGroups=e,this._changeEvent.hasGroups=!0)}get rowCompare(){return this._rowCompare}set rowCompare(e){this._rowCompare!==e&&(this._rowCompare=e,this._changeEvent.rowCompare=!0)}get sortValue(){return this._sortValue}set sortValue(e){this._sortValue!==e&&(this._sortValue=e,this._changeEvent.rowCompare=!0)}get allSelected(){return this._allSelected}set allSelected(e){this._allSelected!==e&&(this._allSelected=e,this._changeEvent.allSelected=!0)}get hovered(){return this._hovered}set hovered(e){this._hovered!==e&&(this._hovered=e,this._changeEvent.hovered=!0)}get editTime(){return this._editTime}set editTime(e){this._editTime!==e&&(this._editTime=e,this._changeEvent.editTime=!0)}get rowsFrozen(){return this._rowsFrozen}set rowsFrozen(e){this._rowsFrozen!==e&&(this._rowsFrozen=e,this._changeEvent.rowsFrozen=!0)}get newRowKey(){return this._newRowKey}set newRowKey(e){this._newRowKey!==e&&(this._newRowKey=e,this._changeEvent.newRowKey=!0)}},Ge=class{onClick=new R;onDoubleClick=new R;onMouseDown=new R;onContextMenu=new R;onSelectMove=new R;onSelectEnd=new R},Ke=class{onMouseLeave=new R;onKeyDown=new R;onContextMenu=new R;onBlur=new R},qe=class{cell=new Ge;content=new Ke;onColumnResize=new R;onColumnsReorder=new R;onRowsAdded=new R;onRowsDeleted=new R;onSortColumn=new R;onFiltersChanged=new R;clear(){for(let e of[this.cell,this.content])for(let t of Object.values(e))t.clear();this.onColumnResize.clear(),this.onColumnsReorder.clear(),this.onRowsAdded.clear(),this.onRowsDeleted.clear(),this.onSortColumn.clear(),this.onFiltersChanged.clear()}},z=e=>`<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${e}</svg>`,Je=z(`<path d="M8 3v10M4.5 9.5 8 13l3.5-3.5"/>`),Ye=z(`<path d="M8 13V3M4.5 6.5 8 3l3.5 3.5"/>`),Xe=z(`<path d="M2.5 3h11l-4.2 5v4.5L6.7 13.5V8z"/>`),Ze=z(`<path d="M3 8.5 6.5 12 13 4.5"/>`),Qe=z(`<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5"/><path d="M4.5 8.2 7 10.7l4.5-5"/>`),$e=z(`<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5"/>`),et=z(`<path d="M13 6 6 13M13 10.5l-2.5 2.5"/>`),tt=z(`<path d="M4 4l8 8M12 4l-8 8"/>`),nt=z(`<path d="M4 6.5 8 10.5l4-4"/>`),rt=z(`<path d="M4 10.5 8 6.5l4 4"/>`),it=z(`<path d="M6 4l4 4-4 4"/>`),at=z(`<rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.5"/><path d="M11 3.75H3.75c-.55 0-1 .45-1 1V11"/>`),ot=z(`<path d="M6 2.75h4v2H6z"/><path d="M10 3.75h1.75c.55 0 1 .45 1 1v8.5c0 .55-.45 1-1 1h-7.5c-.55 0-1-.45-1-1v-8.5c0-.55.45-1 1-1H6"/>`),B=z(`<path d="M8 3.5v9M3.5 8h9"/>`),st=z(`<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.75 7v3.5M9.25 7v3.5"/>`),ct=z(`<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5"/><path d="M4.5 8h7"/>`),lt=`--select-column--`,ut=`<span class="avg-select-box avg-checked">${Qe}</span>`,dt=`<span class="avg-select-box">${$e}</span>`,ft=`<span class="avg-select-box avg-checked">${ct}</span>`;function pt(e){return{key:lt,name:``,width:32,isStatusColumn:!0,resizable:!1,readonly:!0,align:`center`,headerRender:()=>{switch(e.models.selected.selectAllState){case`all`:return ut;case`some`:return ft;default:return dt}},render:t=>e.models.selected.isSelected(t.rowKey)?ut:dt}}var mt=140,ht=class{model;_selectColumn;constructor(e){this.model=e,this.model.events.onColumnResize.subscribe(this.onColumnResize),this.model.events.onColumnsReorder.subscribe(this.onColumnsReorder)}get columnCount(){return this.model.data.columns.length}get firstEditable(){let e=this.model.data.columns.findIndex(e=>!e.readonly&&!T(e));return e===-1?void 0:{col:this.model.data.columns[e],index:e}}getColumnWidth=e=>this.model.data.columns[e]?.width??140;indexOfKey=e=>this.model.data.columns.findIndex(t=>String(t.key)===e);setColumns=e=>{e=ee(e),this.model.options.columns=e,this.updateColumnsData(e),this.model.options.onColumnsChange?.(e)};updateColumns=e=>{this.setColumns(e(this.model.options.columns))};get selectColumn(){return this._selectColumn||=pt(this.model),this._selectColumn}updateColumnsData=e=>{let t=(this.model.options.selectColumn?[this.selectColumn,...e]:e).filter(e=>!e.hidden),n=-1;t.forEach((e,t)=>{T(e)&&(n=t)}),this.model.data.lastIsStatusIndex=n,this.model.data.stickyRightCount=E(t),this.model.data.hasGroups=t.some(e=>e.group!==void 0),this.model.data.columns=t,this.model.data.change()};onColumnResize=({columnKey:e,width:t})=>{t<20||(this.updateColumns(n=>n.map(n=>String(n.key)===e?{...n,width:t}:n)),this.model.options.onColumnResize?.(e,t))};onColumnsReorder=({sourceKey:e,targetKey:t})=>{e!==t&&(this.updateColumns(r=>{let i=r.findIndex(t=>String(t.key)===e),a=r.findIndex(e=>String(e.key)===t);if(i<0||a<0)return r;let o=[...r];return o.splice(a,0,o.splice(i,1)[0]),this.model.update({columns:n(i,a)}),o}),this.model.options.onColumnsReorder?.(e,t))}},gt={"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`};function _t(e){return e.replace(/[&<>"]/g,e=>gt[e])}var vt=`font-family:sans-serif;font-size:12px;border:solid 1px #c0c0c0;border-collapse:collapse`,yt=`border:none;border-bottom:solid 1px #c0c0c0;text-align:left;padding:2px 4px`,bt=class{model;constructor(e){this.model=e,this.model.events.content.onKeyDown.subscribe(this.onContentKeyDown)}get enabled(){return this.model.options.disableClipboard!==!0}copyColumns(e){let t=e.colRange[0];return e.columns.map((e,n)=>({column:e,index:t+n})).filter(e=>!T(e.column))}cellText(e,t,n,r){if(e.copyValue)return e.copyValue(this.cellContext(e,t,n,r));if(e.formatValue||e.displayFormat||!e.render)return D(e,t);let i=e.render(this.cellContext(e,t,n,r));return i==null?``:typeof i==`string`?i.includes(`<`)?this.textOf(i):i:i.textContent??``}cellContext(e,t,n,r){return{value:t[e.key],row:t,column:e,rowIndex:n,colIndex:r,rowKey:this.model.options.getRowKey(t),highlight:this.model.highlightText}}textOf(e){let t=this.model.renderModel?.gridRef.current?.ownerDocument??document,n=this.scratch??=t.createElement(`div`);return n.innerHTML=e,n.textContent??``}scratch;selectionText(e=`copy`){let t=this.model.models.focus.getGridSelection();if(!t)return``;let n=this.copyColumns(t),r=t.rows;if(!n.length||!r.length)return``;let i=t.rowRange[0];if(e===`copyAsJson`)return JSON.stringify(r.map((e,t)=>{let r={};for(let{column:a,index:o}of n)r[String(a.key)]=this.cellText(a,e,i+t,o);return r}),null,4);if(r.length===1&&n.length===1&&e===`copy`){let e=this.cellText(n[0].column,r[0],i,n[0].index);return e==null?``:String(e)}let a=n.map((e,t)=>String(t));return c(r.map((e,t)=>{let r={};return n.forEach(({column:n,index:o},s)=>{r[a[s]]=this.cellText(n,e,i+t,o)}),r}),a,{header:e===`copyWithHeaders`,headerNames:n.map(({column:e})=>e.name??String(e.key)),delimiter:`	`})}selectionHtml(){let e=this.model.models.focus.getGridSelection();if(!e)return``;let t=this.copyColumns(e);if(!t.length||!e.rows.length)return``;let n=e.rowRange[0],r=(e,t)=>`<td style="${yt};font-weight:${t}">${_t(e==null?``:String(e))}</td>`;return`<table style="${vt}"><thead>${`<tr>${t.map(({column:e})=>r(e.name??String(e.key),600)).join(``)}</tr>`}</thead><tbody>${e.rows.map((e,i)=>`<tr>${t.map(({column:t,index:a})=>r(this.cellText(t,e,n+i,a),400)).join(``)}</tr>`).join(``)}</tbody></table>`}writeToEvent(e,t=`copy`){let n=e.clipboardData;if(!n)return!1;let r=this.selectionText(t);return r?(n.setData(`text/plain`,r),t===`copyAsHtmlTable`&&n.setData(`text/html`,this.selectionHtml()),!0):!1}async copySelection(e=`copy`){let t=this.selectionText(e);if(!t)return!1;if(e===`copyAsHtmlTable`){let e=this.selectionHtml(),n=navigator.clipboard;if(n?.write&&typeof ClipboardItem<`u`)try{return await n.write([new ClipboardItem({"text/html":new Blob([e],{type:`text/html`}),"text/plain":new Blob([t],{type:`text/plain`})})]),!0}catch{}}try{return await navigator.clipboard?.writeText(t),!0}catch{return this.copyByExecCommand(t)}}copyByExecCommand(e){let t=this.model.renderModel?.gridRef.current?.ownerDocument??document,n=t.createElement(`textarea`);n.value=e,n.style.cssText=`position:fixed;top:-9999px;opacity:0`,n.setAttribute(`aria-hidden`,`true`),t.body.appendChild(n);try{return n.select(),t.execCommand?.(`copy`)??!1}catch{return!1}finally{n.remove(),this.model.focusGrid()}}async cut(){if(!this.model.options.editable)return this.copySelection();let e=await this.copySelection();return e&&this.model.models.editing.deleteRange(),e}pasteFromEvent(e){let t=e.clipboardData?.getData(`text/plain`);return t?this.pasteText(t):!1}async paste(){try{let e=await navigator.clipboard?.readText();return e?this.pasteText(e):!1}catch{return!1}}pasteText(e){if(!e)return!1;let t=u(e);if(!t.length&&e.length&&(t=[[e]]),!t.length||!t[0].length)return!1;let n=this.pasteTarget(t.length,t[0].length);if(!n)return!1;let r=!1;for(let e=n.rowStart,i=0;e<=n.rowEnd;e++){for(let a=n.colStart,o=0;a<=n.colEnd;a++){let n=t[i]?.[o];this.model.models.editing.editCellAt(e,a,n,!0)&&(r=!0),o=(o+1)%t[0].length}i=(i+1)%t.length}return n.expanded&&this.model.models.focus.selectRange(n.rowStart,n.colStart,n.rowEnd,n.colEnd),r&&this.model.update({all:!0}),r}pasteTarget(e,t){let n=this.model.models.focus.getGridSelection();if(!n)return;let[r,i]=n.rowRange,[a,o]=n.colRange;if(r!==i||a!==o)return{rowStart:r,rowEnd:i,colStart:a,colEnd:o,expanded:!1};let s=this.model.models.structure,c=r+e-this.model.data.rows.length;c>0&&s.canAddRows&&s.addBlankRows(c,void 0,!1);let l=a+t-this.model.data.columns.length;return l>0&&s.canAddColumns&&s.addBlankColumns(l),{rowStart:r,colStart:a,rowEnd:Math.min(r+e-1,this.model.data.rows.length-1),colEnd:Math.min(a+t-1,this.model.data.columns.length-1),expanded:!0}}onContentKeyDown=e=>{this.enabled&&(!e.ctrlKey||!e.shiftKey||e.code!==`KeyC`||this.model.models.focus.focus&&(e.preventDefault(),this.copySelection(`copyWithHeaders`)))}},xt={rowKey:``,columnKey:``,value:void 0,openedBy:`key`,changed:!1},St=new Set([`Enter`,`NumpadEnter`,`F2`]),Ct=class{model;createEditor;editor;editRow=-1;editCol=-1;closing=!1;constructor(e){this.model=e,this.model.events.content.onKeyDown.subscribe(this.onContentKeyDown),this.model.events.cell.onDoubleClick.subscribe(this.onCellDoubleClick),this.model.events.cell.onMouseDown.subscribe(this.onCellMouseDown)}get isEditing(){return this.editRow>=0}get edit(){return this.isEditing?this.model.state.get().cellEdit:void 0}isEditingCell=(e,t)=>e===this.editRow&&t===this.editCol&&this.editRow>=0;canEdit(e){return!!(this.model.options.editable&&e&&!e.readonly&&!T(e))}togglesInsteadOfEditing(e){return e?.dataType===`boolean`&&!e.editor}openEdit=(e,t,n,r=n===void 0?`key`:`typing`,i)=>{let a=this.model.data.columns[t],o=this.model.data.rows[e];if(o===void 0||!this.canEdit(a)||this.togglesInsteadOfEditing(a))return;this.isEditing&&this.closeEdit(!0,!1);let s=n===void 0?o[a.key]:n;this.model.state.update(e=>{e.cellEdit={rowKey:this.model.options.getRowKey(o),columnKey:a.key,value:s,openedBy:r,pointerX:i,changed:n!==void 0}}),this.editRow=e,this.editCol=t,this.editor=void 0,this.model.models.rows.freezeRows(),this.markCell(e,t)};closeEdit=(e,t=!0)=>{if(!this.isEditing||this.closing)return;this.closing=!0;let n=this.model.state.get().cellEdit,r=this.editRow,i=this.editCol;this.detachEditor(),this.model.state.update(e=>{e.cellEdit={...xt}}),this.editRow=-1,this.editCol=-1,e&&n.changed&&this.editCellAt(r,i,n.value,!0),this.markRow(r),this.closing=!1,t&&this.model.focusGrid()};commitEdit=()=>this.closeEdit(!0);cancelEdit=()=>this.closeEdit(!1);onFocusMoved=()=>{if(!this.isEditing)return;let e=this.model.models.focus.focus,t=this.model.state.get().cellEdit;t&&(e&&e.columnKey===t.columnKey&&e.rowKey===t.rowKey||this.closeEdit(!0,!1))};editCellAt=(e,t,n,r=!1)=>{let i=this.model.data.columns[t],a=this.model.data.rows[e];if(a===void 0||!this.canEdit(i))return!1;let o=a[i.key],s=i.validate?i.validate(i,a,n):this.coerce(i,a,n,o);return s===void 0&&n!==void 0&&n!==``?(this.model.options.onInvalidEdit?.({value:n,row:a,column:i,rowIndex:e,colIndex:t}),!1):o===s||this.model.options.onEdit?.({value:s,previousValue:o,row:a,column:i,columnKey:String(i.key),rowKey:this.model.options.getRowKey(a),rowIndex:e,colIndex:t})===!1?!1:(this.model.models.rows.freezeRows(),a[i.key]=s,this.model.data.newRowKey===this.model.options.getRowKey(a)&&(this.model.data.newRowKey=void 0,this.model.data.change()),r||this.markRow(e),!0)};coerce(e,t,n,r){return e.dataType===void 0&&typeof r==`number`&&typeof n==`string`&&n.trim()!==``&&Number.isFinite(Number(n))?Number(n):O(e,t,n)}deleteRange=()=>{let e=this.model.models.focus.getGridSelection();if(!e)return;let t=!1,[n,r]=e.rowRange,[i,a]=e.colRange;for(let e=i;e<=a;e++)if(this.canEdit(this.model.data.columns[e]))for(let i=n;i<=r;i++)this.editCellAt(i,e,void 0,!0)&&(t=!0);t&&this.model.update({all:!0})};toggleBooleanCell=(e,t)=>{let n=this.model.data.columns[t],r=this.model.data.rows[e];r===void 0||!this.canEdit(n)||n.dataType===`boolean`&&(this.editCellAt(e,t,!x(r[n.key])),this.model.focusGrid())};toggleBooleans=e=>{let t=this.model.models.focus.getGridSelection();if(!t||!t.columns.every(e=>e.dataType===`boolean`))return;let[n,r]=t.rowRange,[i,a]=t.colRange,o=this.model.data.columns[t.focusCol],s=this.model.data.rows[t.focusRow];if(!o||s===void 0)return;let c=!x(s[o.key]),l=!1;for(let t=i;t<=a;t++){let i=this.model.data.columns[t];if(this.canEdit(i))for(let a=n;a<=r;a++){let n=this.model.data.rows[a];if(n===void 0)continue;let r=e?c:!x(n[i.key]);this.editCellAt(a,t,r,!0)&&(l=!0)}}l&&this.model.update({all:!0})};editorElement(){if(!this.isEditing)return;if(this.editor)return this.editor.element;let e=this.model.data.columns[this.editCol],t=this.model.data.rows[this.editRow],n=this.model.state.get().cellEdit;if(!e||t===void 0||!n)return;let r={value:n.value,row:t,column:e,rowIndex:this.editRow,colIndex:this.editCol,rowKey:n.rowKey,openedBy:n.openedBy??`key`,pointerX:n.pointerX,setValue:this.setEditValue,commit:this.commitEdit,cancel:this.cancelEdit,commitAndPass:this.commitAndPass},i;if(e.editor){let t=e.editor(r);i=t instanceof HTMLElement?{element:t}:t}else if(this.createEditor)i=this.createEditor(r);else return;return this.adopt(i),this.editor={...i,focus:i.focus??(()=>i.element.focus())},this.editor.element}adopt(e){let t=e.element;t.classList.add(`avg-cell-editor`),t.hasAttribute(`data-type`)||t.setAttribute(`data-type`,`cell-editor`),t.addEventListener(`keydown`,this.onEditorKeyDown)}onEditorKeyDown=e=>{!this.isEditing||e.defaultPrevented||(e.key===`Escape`?(e.preventDefault(),this.cancelEdit()):e.key===`Tab`&&(e.preventDefault(),this.commitAndPass(e)))};editorMounted(){let e=this.editor;e&&queueMicrotask(()=>{this.editor===e&&e.element.isConnected&&e.focus()})}ownsCell(e){return this.editor!==void 0&&this.editor.element.parentElement===e}releaseCell(){queueMicrotask(()=>this.closeEdit(!0,!1))}onViewportScrolled=()=>{if(!this.isEditing)return;let e=this.model.renderModel?.renderInfo.current.rendered;if(!e)return;let t=this.model.dataRowToGridRow(this.editRow);(t<e.top||t>e.bottom)&&this.closeEdit(!0,!1)};setEditValue=e=>{this.model.state.update(t=>{t.cellEdit&&={...t.cellEdit,value:e,changed:!0}})};commitAndPass=e=>{this.closeEdit(!0),this.model.events.content.onKeyDown.send(e)};detachEditor(){let e=this.editor;this.editor=void 0,e?.destroy?.(),e?.element.removeEventListener(`keydown`,this.onEditorKeyDown),e?.element.remove()}markCell(e,t){e<0||t<0||this.model.update({cells:[{row:this.model.dataRowToGridRow(e),col:t}]})}markRow(e){e<0||this.model.update({rows:[this.model.dataRowToGridRow(e)]})}onCellMouseDown=e=>{!e.wasFocused||e.e.button!==0||e.e.shiftKey||e.e.ctrlKey||e.e.altKey||e.e.metaKey||!this.canEdit(e.col)||this.togglesInsteadOfEditing(e.col)||this.isEditingCell(e.rowIndex,e.colIndex)||this.openEdit(e.rowIndex,e.colIndex,void 0,`pointer`,e.e.clientX)};onCellDoubleClick=e=>{if(this.canEdit(e.col)){if(this.togglesInsteadOfEditing(e.col)){this.toggleBooleans(!1);return}this.isEditingCell(e.rowIndex,e.colIndex)||this.openEdit(e.rowIndex,e.colIndex,void 0,`pointer`,e.e?.clientX)}};onContentKeyDown=e=>{if(!this.model.options.editable)return;let t=this.model.models.focus.getGridFocus();if(!t)return;let{column:n,rowIndex:r,colIndex:i}=t;if(St.has(e.code)){e.preventDefault(),this.togglesInsteadOfEditing(n)?this.toggleBooleans(!0):this.model.models.focus.singleCellSelected&&this.openEdit(r,i);return}if(e.code===`Space`&&n.dataType===`boolean`){e.preventDefault(),this.togglesInsteadOfEditing(n)?this.toggleBooleans(!1):this.model.models.focus.singleCellSelected&&this.openEdit(r,i);return}if(e.code===`Delete`&&!e.ctrlKey){e.preventDefault(),this.deleteRange();return}if(e.code===`Escape`){this.closeEdit(!1);return}e.key.length===1&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!this.togglesInsteadOfEditing(n)&&this.model.models.focus.singleCellSelected&&(e.preventDefault(),this.openEdit(r,i,e.key))}},wt={charWidth:8,padding:20,minWidth:60,maxWidth:300,sampleSize:100};function Tt(e,t,n,r){let i=r?.sampleSize??wt.sampleSize,a=Math.min(e.length,i),o=[];for(let n=0;n<a;n++)o.push(e[n]?.[t]);return Et(o,n,r)}function Et(e,t,n){let{charWidth:r,padding:i,minWidth:a,maxWidth:o}={...wt,...n},s=t.length*r+i;for(let t of e){if(t==null)continue;let e=(t instanceof Date?t.toLocaleString():String(t)).length*r+i;e>s&&(s=e)}return Math.max(a,Math.min(s,o))}function Dt(e,t,n){let r={};for(let i of t)r[i]=Tt(e,i,i,n);return r}var Ot=50,V=class extends Error{name=`AVGridError`};function H(e){throw new V(e)}function U(e){return e===null?`null`:e===void 0?`undefined`:Array.isArray(e)?`an array of ${e.length}`:`a ${typeof e}`}function kt(e){if(typeof e==`string`){typeof document>`u`&&H(`AVGrid.create("${e}", …) needs a document to resolve the selector. Pass an element instead when running outside a browser.`);let t=document.querySelector(e);return t||H(`No element matches the selector "${e}". Check the selector, or pass the element itself: AVGrid.create(document.getElementById("grid"), { rows }).`),t}if(e&&typeof e==`object`&&typeof e.appendChild==`function`)return e;H(`AVGrid.create(container, options): container must be an element or a CSS selector, but was ${U(e)}. Pass the element the grid should fill, e.g. AVGrid.create(document.getElementById("grid"), { rows }).`)}function At(e){let t=[],n=new Set,r=Math.min(e.length,Ot);for(let i=0;i<r;i++){let r=e[i];if(!(!r||typeof r!=`object`))for(let e of Object.keys(r))n.has(e)||(n.add(e),t.push(e))}return t}var jt=new Set([`id`,`url`,`uri`,`api`,`ip`,`sql`,`css`,`html`]);function Mt(e){let t=e.replace(/[_-]+/g,` `).replace(/([a-z0-9])([A-Z])/g,`$1 $2`).trim();return t?t.split(/\s+/).map(e=>jt.has(e.toLowerCase())?e.toUpperCase():e.charAt(0).toUpperCase()+e.slice(1)).join(` `):e}function Nt(e,t){let n=[],r=Math.min(e.length,Ot);for(let i=0;i<r;i++){let r=e[i]?.[t];r!=null&&n.push(r)}return n}function Pt(e){let t=e.find(e=>e!=null);if(t===void 0)return[];if(Array.isArray(t)){let n=t.length,r=Math.min(e.length,Ot);for(let t=0;t<r;t++){let r=e[t];Array.isArray(r)&&r.length>n&&(n=r.length)}return Array.from({length:n},(t,n)=>({key:String(n),name:String(n+1),width:Tt(e,String(n),String(n+1))}))}return typeof t!=`object`&&H(`Cannot infer columns from rows of type ${typeof t}. Rows must be objects or arrays — or pass \`columns\` explicitly.`),At(e).map(t=>{let n=Mt(t),r=Nt(e,t),i=r.length>0&&r.every(e=>typeof e==`boolean`),a=r.length>0&&r.every(e=>typeof e==`number`),o=r.length>0&&r.every(e=>e instanceof Date),s={key:t,name:n,width:Tt(e,t,n),resizable:!0};return i?s.dataType=`boolean`:a?s.dataType=`number`:o&&(s.displayFormat=`dateTime`),s})}function Ft(e){let t=e.find(e=>e!=null);if(!(!t||typeof t!=`object`||Array.isArray(t)))return[`id`,`key`,`_id`,`uuid`,`rowKey`].find(e=>e in t&&t[e]!==null&&t[e]!==void 0)}function It(e){let t=Ft(e);if(t!==void 0)return e=>String(e?.[t]);let n=new WeakMap,r=0;return e=>{if(e==null)return``;if(typeof e!=`object`)return String(e);let t=n.get(e);return t===void 0&&(t=`r${r++}`,n.set(e,t)),t}}function Lt(e){return e.length?`Available columns: ${e.join(`, `)}.`:`the grid has no columns`}function Rt(e,t,n){for(let r=n;r<e.length;r++){let n=e[r];if(n&&typeof n==`object`&&t in n)return!0}return!1}function zt(e,t,n){Array.isArray(e)||H(`\`columns\` must be an array, but was ${U(e)}. Omit it entirely to infer the columns from the rows.`);let r=new Set,i=At(t),a=new Set(i),o=i.length>0,s;return e.forEach((e,c)=>{(!e||typeof e!=`object`)&&H(`columns[${c}] must be an object like { key: "name" }, but was ${U(e)}.`);let l=e.key;(typeof l!=`string`||!l.length)&&H(`columns[${c}] has no \`key\`. Every column needs one: { key: "name", name: "Name" }. The key is the property read from each row, and the column's identity everywhere in the API.`),r.has(l)&&H(`Duplicate column key "${l}" at columns[${c}]. Column keys must be unique — they identify the column in sort, filters, focus and events.`),r.add(l);let u=e;u.filter!==void 0&&Vt(u.filter,l),u.pinned!==void 0&&u.pinned!==`left`&&u.pinned!==`right`&&H(`Column "${l}" has pinned: ${U(u.pinned)}. The only values are "left" and "right".`),u.pinned===`right`&&u.isStatusColumn&&H(`Column "${l}" has both isStatusColumn: true and pinned: "right". isStatusColumn means pinned left — a column cannot be pinned to both edges.`),(u.pinned!==void 0||u.isStatusColumn)&&typeof u.width==`string`&&H(`Column "${l}" is pinned but has width: "${u.width}". A pinned column needs a fixed width in pixels — a percentage is resolved by stretching the scrolling columns to fit, which a pinned band is outside of.`),u.group!==void 0&&typeof u.group!=`string`&&H(`Column "${l}" has group: ${U(u.group)}. A group is its label — a string shared by the columns under one group cell.`),u.group!==void 0&&(u.pinned!==void 0||u.isStatusColumn)&&H(`Column "${l}" is pinned and has group: "${u.group}". Group cells live in the scrolling band, so a pinned column cannot be grouped — unpin it, or drop the group.`),u.hidden||(u.pinned===`right`?s=l:s!==void 0&&H(`Column "${l}" follows the pinned: "right" column "${s}" but is not pinned itself. Right-pinned columns must be the trailing columns — move "${l}" before them, or pin it too.`)),!(u.render||u.formatValue||T(u))&&!n?.has(l)&&o&&!a.has(l)&&!Rt(t,l,Ot)&&H(`Unknown column "${l}". ${Lt(i)} If the column is computed rather than read from the row, give it a \`render\` function.`)}),Bt(e,t)}function Bt(e,t){if(!e.some(e=>e.width===void 0))return e;let n=Math.min(t.length,Ot);return e.map(e=>{if(e.width!==void 0)return e;let r=[];for(let i=0;i<n;i++){let n=t[i];if(n==null)continue;let a=D(e,n);a!=null&&r.push(a)}if(!r.length)return e;let i=e.name??String(e.key);return{...e,width:Et(r,i)}})}function Vt(e,t){(!e||typeof e!=`object`)&&H(`Column "${t}" has a \`filter\` that is ${U(e)}. It must be a filter definition: { name, create, label, match }.`);let n=e;(typeof n.name!=`string`||!n.name.length)&&H(`Column "${t}" has a \`filter\` with no \`name\`. The name identifies the filter type and is what persistence stores: { name: "dateRange", create, label, match }.`);for(let[e,r]of[[`create`,`create: (ctx) => ({ element, getValue })   // the popover body`],[`label`,`label: (value, column) => String(value)     // the chip's text`],[`match`,`match: (value, row, column) => boolean      // keep the row?`]])typeof n[e]!=`function`&&H(`Column "${t}" has a \`filter\` named "${n.name}" with no \`${e}\` function (it was ${U(n[e])}). Add:\n    ${r}`);for(let e of[`serialize`,`deserialize`])n[e]!==void 0&&typeof n[e]!=`function`&&H(`Column "${t}": \`filter.${e}\` must be a function, but was ${U(n[e])}. Omit it unless the value is not JSON-shaped.`)}function Ht(e,t,n){if(e!=null){if(Array.isArray(e)){n||H("`sort` is an array, but `multiSort` is off. Pass a single { key, direction } object, or set `multiSort: true` to sort by several columns.");let r=e.map((e,n)=>Ut(e,t,`sort[${n}]`)),i=new Set;for(let e of r)i.has(e.key)&&H(`Column "${e.key}" appears twice in \`sort\` — each column may sort once.`),i.add(e.key);return r}return Ut(e,t,`sort`)}}function Ut(e,t,n){(typeof e!=`object`||!e)&&H(`\`${n}\` must be an object like { key: "name", direction: "asc" }, but was ${U(e)}.`);let{key:r,direction:i}=e;return(typeof r!=`string`||!r.length)&&H(`\`${n}.key\` must be a column key, but was ${U(r)}.`),t.some(e=>String(e.key)===r)||H(`Unknown column "${r}" in \`${n}\`. ${Lt(t.map(e=>String(e.key)))}`),i!==`asc`&&i!==`desc`&&H(`\`${n}.direction\` must be "asc" or "desc", but was ${JSON.stringify(i)}.`),{key:r,direction:i}}function Wt(e,t){return e==null?[]:(Array.isArray(e)||H(`\`filters\` must be an array, but was ${U(e)}. Pass an empty array to clear the filters.`),e.map((e,n)=>{(!e||typeof e!=`object`)&&H(`\`filters[${n}]\` must be an object like { columnKey: "status", value: ["open"] }, but was ${U(e)}.`);let r=e,i=r.columnKey;(typeof i!=`string`||!i.length)&&H(`\`filters[${n}].columnKey\` must be a column key, but was ${U(i)}.`);let a=t.find(e=>String(e.key)===i);a||H(`Unknown column "${i}" in \`filters[${n}]\`. ${Lt(t.map(e=>String(e.key)))}`);let o=a.filter,s=o?o.name:r.type??a.filterType??`options`;!o&&s!==`options`&&H(`\`filters[${n}].type\` is ${JSON.stringify(s)}, but column "${i}" has no \`filter\` definition of that name — so nothing knows how to match it. Either give the column a \`filter\`, or use the built-in "options" type.`),o&&r.type!==void 0&&r.type!==o.name&&H(`\`filters[${n}].type\` is ${JSON.stringify(r.type)}, but column "${i}" is filtered by "${o.name}". Omit \`type\` — it is taken from the column.`);let c={...r,columnKey:i,columnName:r.columnName??a.name??i,type:s,displayFormat:r.displayFormat??a.displayFormat,value:r.value};return o||c.value!==void 0&&c.value!==null&&(Array.isArray(c.value)||H(`\`filters[${n}].value\` must be an array of the values to keep, but was ${U(c.value)}. For example: value: ["open", "closed"]. Omit it — or pass an empty array — to remove the filter.`),c.value=c.value.map(e=>typeof e==`object`&&e&&`value`in e?e:{value:e,label:String(e??``)})),c}))}function Gt(e){(!e||typeof e!=`object`)&&H(`AVGrid.create(container, options): options is required and must be an object, but was ${U(e)}. The minimum call is AVGrid.create(el, { rows: [{ id: 1, name: "Ada" }] }).`);let t=e;if(Array.isArray(t.rows)||H(`\`rows\` must be an array, but was ${U(t.rows)}. Pass an empty array to render an empty grid: AVGrid.create(el, { rows: [] }).`),t.footerRows!==void 0&&!Array.isArray(t.footerRows)&&H(`\`footerRows\` must be an array of rows, but was ${U(t.footerRows)}. For example: footerRows: [{ label: "Total", spend: 4812500 }]. Omit it for no footer.`),t.rowHeight!==void 0&&(typeof t.rowHeight!=`number`||!(t.rowHeight>0))&&H(`\`rowHeight\` must be a positive number of pixels, but was ${U(t.rowHeight)}. Omit it for the default of 24.`),t.getRowKey!==void 0&&typeof t.getRowKey!=`function`&&H(`\`getRowKey\` must be a function taking a row and returning a string, but was ${U(t.getRowKey)}. For example: getRowKey: (row) => String(row.id). Omit it to infer one.`),t.selected!==void 0){Array.isArray(t.selected)||H(`\`selected\` must be an array of row keys, but was ${U(t.selected)}. For example: selected: rows.slice(0, 3).map(getRowKey).`);let e=t.selected.find(e=>typeof e!=`string`);e!==void 0&&H(`\`selected\` must contain row keys as strings, but contained ${U(e)}. A row key is what getRowKey returns — not a row object or a row index.`)}let n=t.columns===void 0?Pt(t.rows):ee(zt(t.columns,t.rows));if(Ht(t.sort,n,!!t.multiSort),t.persistFilters!==void 0){let e=t.persistFilters;(!e||typeof e!=`object`||typeof e.name!=`string`||!e.name.length)&&H(`\`persistFilters\` must be an object like { name: "orders" }, but was ${U(t.persistFilters)}. The name becomes the storage key.`)}return{...t,columns:n,filters:Wt(t.filters,n),getRowKey:t.getRowKey??It(t.rows),rowHeight:t.rowHeight??24}}var Kt=`1`,qt=e=>`Filters-${e}`,Jt=/^\d{4}-(0\d|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)\.\d{3}Z$/;function Yt(e){if(e?.name){if(e.storage)return e.storage;try{return typeof localStorage>`u`?void 0:localStorage}catch{return}}}function Xt(e,t){let n=typeof e==`object`&&e&&`value`in e?e.value:e;if(typeof n!=`string`||!(t||Jt.test(n)))return e;let r=new Date(n);return isNaN(r.getTime())?e:typeof e==`object`&&e&&`value`in e?{...e,value:r}:r}function Zt(e,t){return e.map(e=>{let n=e,r=t?.find(e=>String(e.key)===n.columnKey)?.filter;if(r)return r.deserialize?{...n,value:r.deserialize(n.value)}:n;if(!Array.isArray(n.value))return n;let i=n.displayFormat===`date`||n.displayFormat===`dateTime`;return{...n,value:n.value.map(e=>Xt(e,i))}})}function Qt(e){let t=Yt(e);if(!t)return!1;try{return!!t.getItem(qt(e.name))}catch{return!1}}function $t(e,t){let n=Yt(e);if(!(!n||!e))try{let r=n.getItem(qt(e.name));if(!r)return;let i=JSON.parse(r);if(i&&i.configVersion===`1`&&Array.isArray(i.filters))return Zt(i.filters,t)}catch(t){console.warn(`av-grid: could not restore filters from ${qt(e.name)}:`,t)}}function en(e,t,n){let r=Yt(t);if(!(!r||!t))try{let i=n?e.map(e=>{let t=n.find(t=>String(t.key)===e.columnKey)?.filter;return t?.serialize?{...e,value:t.serialize(e.value)}:e}):e;r.setItem(qt(t.name),JSON.stringify({configVersion:`1`,filters:i}))}catch(e){console.warn(`av-grid: could not persist filters:`,e)}}function tn(e,t){return e===t?!0:!e||!t||typeof e!=`object`||typeof t!=`object`||e.label!==t.label?!1:e.value instanceof Date&&t.value instanceof Date?e.value.getTime()===t.value.getTime():e.value===t.value}function nn(e,t,n,r,i,a){let o=t.find(e=>String(e.key)===r),s=n.filter(e=>e.columnKey!==r),c=new Set;for(let n of y(e,t,a,s))c.add(o?.formatValue?o.formatValue(o,n):n?.[r]);let l=Array.from(c);l.sort(d());let u=l.map(e=>({value:e,...e==null?{italic:!0}:void 0,label:e===void 0?`(undefined)`:e===null?`(null)`:f(e,o?.displayFormat)}));if(!i)return u;let p=i.toLowerCase();return u.filter(e=>e.label.toLowerCase().includes(p))}function rn(e,t){if(e===t)return!0;if(!e||!t||typeof e!=`object`||typeof t!=`object`)return!1;try{return JSON.stringify(e)===JSON.stringify(t)}catch{return!1}}function an(e,t){if(e===t)return!0;if(!t||e.columnKey!==t.columnKey||e.type!==t.type)return!1;let n=e.value,r=t.value;return!Array.isArray(n)||!Array.isArray(r)?rn(n,r):n.length===r.length&&n.every((e,t)=>tn(e,r[t]))}var on=class{model;constructor(e){this.model=e;let t=$t(e.options.persistFilters,this.columns);t&&(this.model.options.filters=this.restore(t))}restore(e){let t=[];for(let n of e)try{t.push(...this.validate([n]))}catch(e){console.warn(`av-grid: dropping stored filter for column "${n?.columnKey}":`,e instanceof Error?e.message:e)}return t}get filters(){return this.model.options.filters??[]}getFilters(){return[...this.filters]}filterFor(e){return this.filters.find(t=>t.columnKey===e)}isFiltered(e){return this.filters.some(t=>t.columnKey===e)}filterOrDefault(e){return this.filterFor(e)??this.validate([{columnKey:e}])[0]}getOptions(e,t){let n=this.model.data.columns,r=this.filters.filter(t=>t.columnKey!==e),i=this.model.options.onGetOptions;return i?i(n,r,e,t):nn(this.model.options.rows,n,this.filters,e,t,this.model.options.searchString)}setFilters=e=>{let t=this.validate(e);this.same(t,this.filters)||(this.model.options.filters=t,this.filtersChanged())};applyFilter=e=>{let[t]=this.validate([e]),n=t.value;if(n==null||Array.isArray(n)&&!n.length){this.removeFilter(t.columnKey);return}let r=this.filters,i=r.some(e=>e.columnKey===t.columnKey);this.model.options.filters=i?r.map(e=>e.columnKey===t.columnKey?t:e):[...r,t],this.filtersChanged()};removeFilter=e=>{let t=this.filters,n=t.filter(t=>t.columnKey!==e);n.length!==t.length&&(this.model.options.filters=n,this.filtersChanged())};clearFilters=()=>{this.filters.length&&(this.model.options.filters=[],this.filtersChanged())};get columns(){return this.model.data.columns.length?this.model.data.columns:this.model.options.columns}validate=e=>Wt(e,this.columns);same=(e,t)=>e.length===t.length&&e.every((e,n)=>an(e,t[n]));filtersChanged=()=>{en(this.filters,this.model.options.persistFilters,this.columns),this.model.models.rows.refilterRows(),this.model.options.onFiltersChange?.(this.getFilters()),this.model.events.onFiltersChanged.send(this.getFilters()),this.model.update({rows:[0]})}},sn=1,cn=2,ln=4,un=8,dn=16,fn=32,pn={rowStart:-1,rowEnd:-1,colStart:-1,colEnd:-1,focusRow:-1,focusCol:-1};function mn(e,t){if(e===t)return!0;if(!e||!t||e.rowKey!==t.rowKey||e.columnKey!==t.columnKey||!!e.isDragging!=!!t.isDragging)return!1;let n=e.selection,r=t.selection;return n===r?!0:!n||!r?!1:n.rowStart===r.rowStart&&n.rowEnd===r.rowEnd&&n.colStart===r.colStart&&n.colEnd===r.colEnd&&n.rowKeyStart===r.rowKeyStart&&n.rowKeyEnd===r.rowKeyEnd&&n.colKeyStart===r.colKeyStart&&n.colKeyEnd===r.colKeyEnd}function hn(e,t,n){let r=0;return t>=e.rowStart&&t<=e.rowEnd&&n>=e.colStart&&n<=e.colEnd&&(r=sn,t===e.rowStart&&(r|=cn),t===e.rowEnd&&(r|=ln),n===e.colStart&&(r|=un),n===e.colEnd&&(r|=dn)),t===e.focusRow&&n===e.focusCol&&(r|=fn),r}var gn=new Set([`ArrowDown`,`ArrowUp`,`ArrowLeft`,`ArrowRight`,`Tab`,`PageDown`,`PageUp`,`Home`,`End`]),_n=class{model;focusFromIndex=!1;_focus;ranges=pn;constructor(e){this.model=e,this.model.data.onChange.subscribe(this.onDataChange),this.model.events.cell.onMouseDown.subscribe(this.onCellMouseDown),this.model.events.cell.onSelectMove.subscribe(this.onCellSelectMove),this.model.events.cell.onSelectEnd.subscribe(this.onSelectEnd),this.model.events.content.onKeyDown.subscribe(this.onContentKeyDown)}get focus(){return this._focus}get isDragging(){return!!this._focus?.isDragging}getGridFocus(){let{rows:e,columns:t}=this.model.data,{focusRow:n,focusCol:r}=this.ranges;if(!(n<0||r<0))return{row:e[n],column:t[r],rowIndex:n,colIndex:r}}get singleCellSelected(){let e=this.ranges;return e.focusRow>=0&&e.rowStart===e.rowEnd&&e.colStart===e.colEnd}get selectedCount(){let e=this.ranges;return e.focusRow<0?{rows:0,columns:0,minRow:0,minCol:0}:{rows:e.rowEnd-e.rowStart+1,columns:e.colEnd-e.colStart+1,minRow:e.rowStart,minCol:e.colStart}}getGridSelection(){let e=this.ranges;if(e.focusRow<0)return;let{rows:t,columns:n}=this.model.data;return{rows:t.slice(e.rowStart,e.rowEnd+1),columns:n.slice(e.colStart,e.colEnd+1),focusRow:e.focusRow,focusCol:e.focusCol,rowRange:[e.rowStart,e.rowEnd],colRange:[e.colStart,e.colEnd]}}inSelection(e,t){let n=this.ranges;return t>=n.rowStart&&t<=n.rowEnd&&e>=n.colStart&&e<=n.colEnd}focusClass=(e,t)=>{let n=this.ranges;if(n.focusRow<0)return``;let r=hn(n,t,e);if(r===0)return``;let i=``;return r&sn&&(i+=` avg-in-selection`),r&cn&&(i+=` avg-in-selection-top`),r&ln&&(i+=` avg-in-selection-bottom`),r&un&&(i+=` avg-in-selection-left`),r&dn&&(i+=` avg-in-selection-right`),r&fn&&(i+=` avg-focused`),i};focusCell=(e,t,n)=>{this.updateFocus(e,t,`click`,{withScroll:n})};selectRange=(e,t,n,r)=>{let{columns:i,rows:a}=this.model.data,o=i[t],s=i[r],c=a[e],l=a[n];if(!o||!s||c===void 0||l===void 0)return;let u=this.model.options.getRowKey;this.setFocus({columnKey:s.key,rowKey:u(l),isDragging:!1,selection:{colKeyStart:o.key,rowKeyStart:u(c),colKeyEnd:s.key,rowKeyEnd:u(l),colStart:t,rowStart:e,colEnd:r,rowEnd:n}})};focusNewRows=(e,t,n)=>{let r=this.model.models.columns.firstEditable?.index??this.model.data.columns.findIndex(e=>!T(e));this.selectRange(e,n?.selection?.colStart??Math.max(0,r),e+t-1,n?.selection?.colEnd??Math.max(0,r))};setFocus=e=>{this.applyFocus(t=>{let n=!!t?.isDragging;return!e||!!e.isDragging===n?e:{...e,isDragging:n}})};initFocus=e=>{e&&(this._focus=e.isDragging?{...e,isDragging:!1}:e,this.ranges=this.deriveRanges(this._focus))};clearFocus=()=>{this.applyFocus(()=>void 0)};applyFocus(e){let t=this._focus,n=e(t);if(mn(n,t))return;let r=this.ranges;this._focus=n,this.ranges=this.deriveRanges(n),this.markChanged(r,this.ranges),this.model.models.editing.onFocusMoved(),this.model.options.onFocusChange?.(n),this.model.models.structure.dropUntouchedTrailingRow()}deriveRanges(e){if(!e)return pn;let t=e.selection;if(t)return{rowStart:Math.min(t.rowStart,t.rowEnd),rowEnd:Math.max(t.rowStart,t.rowEnd),colStart:Math.min(t.colStart,t.colEnd),colEnd:Math.max(t.colStart,t.colEnd),focusRow:t.rowEnd,focusCol:t.colEnd};let n=this.model.options.getRowKey,r=this.model.data.rows.findIndex(t=>n(t)===e.rowKey),i=this.model.data.columns.findIndex(t=>t.key===e.columnKey);return r<0||i<0?pn:{rowStart:r,rowEnd:r,colStart:i,colEnd:i,focusRow:r,focusCol:i}}markChanged(e,t){if(e===t)return;let n=this.model.renderModel;if(!n)return;let{rows:r,columns:i}=n.renderInfo.current.renderRange,a=[];for(let n=0;n<r.length;n++){let o=r[n];if(o<=0)continue;let s=o-1;for(let n=0;n<i.length;n++){let r=i[n];hn(e,s,r)!==hn(t,s,r)&&a.push({row:o,col:r})}}if(a.length){let e={cells:a};this.model.update(e)}}updateFocus(e,t,n,r){let{rows:i,columns:a}=this.model.data,o=i[e],s=a[t];if(o===void 0||s===void 0)return;let c=this.model.options.getRowKey;this.applyFocus(i=>{if(n===`drag`&&!i?.isDragging||n===`rightClick`&&this.inSelection(t,e)||n===`drag`&&i?.selection?.rowEnd===e&&i.selection.colEnd===t)return i;let a={rowKeyEnd:c(o),colKeyEnd:s.key,rowEnd:e,colEnd:t},l=n===`click`||n===`rightClick`||!i?.selection?{rowKeyStart:c(o),colKeyStart:s.key,rowStart:e,colStart:t}:{rowKeyStart:i.selection.rowKeyStart,colKeyStart:i.selection.colKeyStart,rowStart:i.selection.rowStart,colStart:i.selection.colStart};return{rowKey:a.rowKeyEnd,columnKey:a.colKeyEnd,isDragging:!!(r?.startDrag||i?.isDragging),selection:{...a,...l}}}),r?.withScroll&&this.model.renderModel?.scrollTo(this.model.dataRowToGridRow(e),t)}onDataChange=e=>{(e.rows||e.columns)&&this.validateFocus()};validateFocus=()=>{let e=this.model.options.getRowKey,{rows:t,columns:n}=this.model.data;this.applyFocus(r=>{if(!r)return r;let i=t.findIndex(t=>e(t)===r.rowKey),a=n.findIndex(e=>e.key===r.columnKey);if(i<0||a<0||this.focusFromIndex){if(this.focusFromIndex=!1,!t.length||!n.length)return;let i=Math.min(r.selection?.rowEnd??0,t.length-1),a=Math.min(r.selection?.colEnd??0,n.length-1),o=e(t[i]),s=n[a].key;return{columnKey:s,rowKey:o,isDragging:!1,selection:{colStart:a,colKeyStart:s,rowStart:i,rowKeyStart:o,colEnd:a,colKeyEnd:s,rowEnd:i,rowKeyEnd:o}}}let o=r.selection;if(!o)return r;let s=t.findIndex(t=>e(t)===o.rowKeyStart),c=n.findIndex(e=>e.key===o.colKeyStart);return s===o.rowStart&&c===o.colStart&&i===o.rowEnd&&a===o.colEnd?r:(this.model.flags.noScrollOnFocus?this.model.flags.noScrollOnFocus=!1:this.model.renderModel?.scrollToRow(this.model.dataRowToGridRow(i),`center`),{...r,selection:{...o,rowStart:i,colStart:a,rowEnd:i,colEnd:a}})})};onCellMouseDown=e=>{let t=e.e.button===0;this.updateFocus(e.rowIndex,e.colIndex,e.e.shiftKey?`shiftClick`:t?`click`:`rightClick`,{startDrag:t})};onCellSelectMove=e=>{this.updateFocus(e.rowIndex,e.colIndex,`drag`)};onSelectEnd=()=>{this._focus?.isDragging&&(this._focus={...this._focus,isDragging:!1})};onContentKeyDown=e=>{let{rows:t,columns:n}=this.model.data;if(e.ctrlKey&&e.code===`KeyA`&&t.length&&n.length){e.preventDefault(),e.stopPropagation(),this.selectRange(0,0,t.length-1,n.length-1);return}if(!gn.has(e.key)||!t.length||!n.length)return;e.preventDefault(),e.stopPropagation();let r=this.ranges.focusRow,i=this.ranges.focusCol,a=Math.min(n.length-1,this.model.data.lastIsStatusIndex+1);if(r<0||i<0){this.updateFocus(0,a,`click`,{withScroll:!0});return}let o=this.model.renderModel?.visibleRowCount||1,s=t.length-1,c=n.length-1,l=()=>this.model.models.structure.addTrailingRow().length?(s=this.model.data.rows.length-1,!0):!1;switch(e.key){case`ArrowDown`:r===s&&!e.ctrlKey&&!e.shiftKey&&l(),r=e.ctrlKey?Math.min(s,r+o):Math.min(s,r+1);break;case`ArrowUp`:r=e.ctrlKey?Math.max(0,r-o):Math.max(0,r-1);break;case`PageDown`:r=Math.min(s,r+o);break;case`PageUp`:r=Math.max(0,r-o);break;case`End`:r=s,e.ctrlKey&&(i=c);break;case`Home`:r=0,e.ctrlKey&&(i=a);break;case`ArrowLeft`:i=e.ctrlKey?a:Math.max(a,i-1);break;case`ArrowRight`:e.ctrlKey&&i===c&&this.model.models.structure.canAddColumns&&this.model.models.structure.addBlankColumns(1).length&&(c=this.model.data.columns.length-1),i=e.ctrlKey?c:Math.min(c,i+1);break;case`Tab`:e.shiftKey?i>a?i--:(i=c,r=Math.max(0,r-1)):(i=i<c?i+1:a,i===a&&r===s&&l(),i===a&&r<s&&r++)}this.updateFocus(r,i,e.shiftKey&&e.key!==`Tab`?`shiftClick`:`click`,{withScroll:!0})}},vn=class{model;constructor(e){this.model=e,this.model.data.onChange.subscribe(this.onDataChange),this.model.events.onRowsAdded.subscribe(this.onRowsAdded),this.model.events.onRowsDeleted.subscribe(this.onRowsDeleted)}get rowCount(){return this.model.data.rows.length+1+(this.model.options.footerRows?.length??0)}freezeRows=()=>{let{searchString:e,filters:t}=this.model.options;!this.model.state.get().sort&&!e?.length&&!t?.length||(this.model.data.rowsFrozen=!0,this.model.data.change(),this.model.update({rows:[0]}))};unfreezeRows=()=>{this.model.data.rowsFrozen&&(this.clearFreeze(),this.updateRows())};refilterRows=()=>{this.clearFreeze(),this.updateRows()};clearFreeze=()=>{this.model.data.rowsFrozen&&(this.model.data.rowsFrozen=!1,this.model.data.change(),this.model.update({rows:[0]}))};updateRows=()=>{if(this.model.syncSearchWords(),this.model.data.rowsFrozen){this.updateFrozenRows();return}let e=this.model.state.get().sort,t=Array.isArray(e)?void 0:e?.direction,n=this.model.options.rows;n=this.filter(n),n=this.sort(n,t);let r=n!==this.model.data.rows;this.model.data.rows=n,this.model.data.change(),this.model.update({all:!0}),r&&this.model.renderModel&&this.model.options.onVisibleRowsChange?.(n)};filter=e=>y(e,this.model.data.columns,this.model.options.searchString,this.model.options.filters);sort=(e,t)=>{let n=this.model.data.rowCompare;if(!n)return e;let r=this.model.data.sortValue,i;return r?i=this.sortByValue(e,r,n):(i=[...e],i.sort(n)),t===`desc`?i.reverse():i};sortByValue=(e,t,n)=>{let r=e.map(e=>({row:e,value:t(e)}));return r.sort((e,t)=>n(e.value,t.value)),r.map(e=>e.row)};onDataChange=e=>{e.rowCompare&&(this.model.data.rowsFrozen?this.unfreezeRows():this.updateRows()),e.columns&&this.updateRows(),e.rows&&this.model.requestRepaint()};updateFrozenRows=()=>{if(!this.model.data.rowsFrozen)return;let e=this.model.options.getRowKey,t=this.model.data.rows.reduce((t,n,r)=>(t[e(n)]=r,t),{}),n=[...this.model.data.rows];this.model.options.rows.forEach(r=>{let i=t[e(r)];i!==void 0&&(n[i]=r)}),this.model.data.rows=n,this.model.data.change(),this.model.update({all:!0})};onRowsAdded=({rows:e,insertIndex:t})=>{if(!this.model.data.rowsFrozen)return;let n=[...this.model.data.rows];n.splice(t??n.length,0,...e),this.model.data.rows=n};onRowsDeleted=({rowKeys:e})=>{if(!this.model.data.rowsFrozen)return;let t=this.model.options.getRowKey;this.model.data.rows=this.model.data.rows.filter(n=>!e.includes(t(n)))}},yn=class{model;_selected;constructor(e){this.model=e,this._selected=new Set(e.options.selected??[]),this.model.data.onChange.subscribe(this.onDataChange)}get selected(){return this._selected}get count(){return this._selected.size}get allSelected(){return this.model.data.allSelected}get selectAllState(){return this.allSelected?`all`:this._selected.size>0?`some`:`none`}isSelected=e=>this._selected.has(e);getSelectedKeys(){return[...this._selected]}getSelectedRows(){if(this._selected.size===0)return[];let e=this.model.options.getRowKey;return this.model.data.rows.filter(t=>this._selected.has(e(t)))}rowClass=e=>{if(this._selected.size===0)return``;let t=this.model.data.rows[e];return t===void 0?``:this._selected.has(this.model.options.getRowKey(t))?` avg-row-selected`:``};setSelected=e=>{this.apply(new Set(e??[]))};toggleSelected=e=>{let t=new Set(this._selected);t.delete(e)||t.add(e),this.apply(t)};setRowSelected=(e,t)=>{if(this._selected.has(e)===t)return;let n=new Set(this._selected);t?n.add(e):n.delete(e),this.apply(n)};selectAll=()=>{let e=this.model.options.getRowKey,t=this.model.data.rows;this.apply(new Set(t.map(t=>e(t))),t.length>0)};deselect=e=>{if(this._selected.size===0)return;let t=new Set(this._selected),n=!1;for(let r of e)t.delete(r)&&(n=!0);n&&this.apply(t)};clearSelected=()=>{this._selected.size!==0&&this.apply(new Set,!1)};toggleAll=()=>{this.selectAllState===`none`?this.selectAll():this.clearSelected()};apply(e,t){let n=this._selected;if(bn(n,e))return;let r=this.selectAllState;this._selected=e,this.updateAllSelected(t),this.markChanged(n,e,r),this.model.options.onSelectionChange&&this.model.options.onSelectionChange(this.getSelectedKeys())}markChanged(e,t,n){let r=this.model.renderModel;if(!r)return;let i=this.model.options.getRowKey,a=this.model.data.rows,o=r.renderInfo.current.renderRange.rows,s=[];this.selectAllState!==n&&s.push(0);for(let n=0;n<o.length;n++){let r=o[n];if(r<=0)continue;let c=a[r-1];if(c===void 0)continue;let l=i(c);e.has(l)!==t.has(l)&&s.push(r)}s.length&&this.model.update({rows:s})}updateAllSelected(e){if(e!==void 0){this.model.data.allSelected=e,this.model.data.change();return}let t=this.model.options.getRowKey,n=this.model.data.rows;this.model.data.allSelected=this._selected.size>0&&this._selected.size===n.length&&n.every(e=>this._selected.has(t(e))),this.model.data.change()}onDataChange=e=>{if(!e.rows)return;let t=this.selectAllState;this.updateAllSelected(),this.selectAllState!==t&&this.model.update({rows:[0]})}};function bn(e,t){if(e===t)return!0;if(e.size!==t.size)return!1;for(let n of e)if(!t.has(n))return!1;return!0}var xn=class{model;constructor(e){this.model=e,this.model.data.onChange.subscribe(this.onDataChange),this.model.events.onSortColumn.subscribe(({columnKey:e,append:t})=>this.sortColumn(e,t))}get sort(){return this.model.state.get().sort}get sortList(){return S(this.model.state.get().sort)}sortColumn=(e,t=!1)=>{if(this.model.options.disableSorting)return;let n=String(e),r=this.sortList,i;if(t&&this.model.options.multiSort){i=[...r];let e=i.findIndex(e=>e.key===n);e<0?i.push({key:n,direction:`asc`}):i[e].direction===`asc`?i[e]={key:n,direction:`desc`}:i.splice(e,1)}else i=r.length===1&&r[0].key===n?r[0].direction===`asc`?[{key:n,direction:`desc`}]:[]:[{key:n,direction:`asc`}];this.store(i),this.sortChanged()};setSort=e=>{let t=this.model.state.get().sort;w(t,e)||(this.store(S(e)),this.sortChanged())};get reported(){let e=this.model.state.get().sort;return this.model.options.multiSort?S(e):e}normalizeArity=()=>{this.store(this.sortList)};store=e=>{let t=!!this.model.options.multiSort;this.model.state.update(n=>{n.sort=e.length===0?void 0:t?e:e[0]})};sortChanged=()=>{let e=this.model.data.rowCompare,t=this.model.data.sortValue;this.updateRowCompare(),this.model.data.rowCompare===e&&this.model.data.sortValue===t&&this.model.models.rows.updateRows(),this.model.options.onSortChange?.(this.reported),this.model.update({rows:[0]})};onDataChange=e=>{e.columns&&this.updateRowCompare()};updateRowCompare=()=>{let e,t,n=this.model.state.get().sort;if(n!==void 0&&Array.isArray(n)){let r=d(),i=n.map(({key:e,direction:t})=>{let n=this.model.data.columns.find(t=>String(t.key)===e);return{sign:t===`desc`?-1:1,rowCompare:n?.rowCompare,value:n?.rowCompare?void 0:n?.sortValue??(t=>t[e])}});t=e=>i.map(t=>t.value?t.value(e):e),e=(e,t)=>{for(let n=0;n<i.length;n++){let a=i[n],o=a.rowCompare?a.rowCompare(e[n],t[n]):r(e[n],t[n]);if(o)return a.sign*o}return 0}}else if(n){let r=n,i=this.model.data.columns.find(e=>String(e.key)===r.key);i?.rowCompare?e=i.rowCompare:i?.sortValue?(t=i.sortValue,e=d()):e=d(r.key)}this.model.data.sortValue=t,this.model.data.rowCompare=e,this.model.data.change()}},Sn=class{model;nextPlaceholder=1;rowKeyProperty;addingTrailingRow=!1;constructor(e){this.model=e,this.model.events.content.onKeyDown.subscribe(this.onContentKeyDown)}addRows=(e,t,n=!1)=>{if(!e.length)return[];let r=this.model.data.rows,i=t===void 0?r.length:Math.max(0,Math.min(t,r.length));if(this.model.options.onAddRows?.({rows:e,index:i})===!1)return[];this.model.models.rows.freezeRows();let a=[...this.model.options.rows];return a.splice(this.sourceIndex(i),0,...e),this.model.options.rows=a,this.model.flags.noScrollOnFocus=!0,this.model.events.onRowsAdded.send({rows:e,insertIndex:i}),this.model.models.rows.updateRows(),n&&(this.model.models.focus.focusNewRows(i,e.length,this.model.models.focus.focus),this.model.renderModel?.scrollToRow(this.model.dataRowToGridRow(i+e.length-1))),e};addBlankRows=(e=1,t,n=!0)=>{if(e<1)return[];let r=this.model.data.rows,i=t===void 0?r.length:t,a=Array.from({length:e},(e,t)=>this.blankRow(i+t));return this.addRows(a,t,n)};addTrailingRow=()=>{if(!this.canAddRows||this.model.data.newRowKey)return[];this.addingTrailingRow=!0;try{let e=this.addBlankRows(1,void 0,!1);return e.length&&(this.model.data.newRowKey=this.model.options.getRowKey(e[0]),this.model.data.change()),e}finally{this.addingTrailingRow=!1}};dropUntouchedTrailingRow=()=>{let e=this.model.data.newRowKey;if(e===void 0||this.addingTrailingRow)return;let t=this.displayIndexOfKey(e);if(t<0){this.model.data.newRowKey=void 0,this.model.data.change();return}let{rows:n,minRow:r}=this.model.models.focus.selectedCount;n>0&&t>=r&&t<r+n||(this.model.data.newRowKey=void 0,this.model.data.change(),this.deleteRows([e]))};deleteRows=(e,t=!1)=>{if(!e.length)return!1;let n=new Set(e),r=this.model.options.getRowKey,i=[],a=[];for(let e of this.model.options.rows)(n.has(r(e))?i:a).push(e);if(!i.length||this.model.options.onDeleteRows?.({rows:i,rowKeys:i.map(r)})===!1)return!1;let{minRow:o,minCol:s}=this.model.models.focus.selectedCount;if(this.model.models.editing.isEditing&&this.model.models.editing.cancelEdit(),this.model.options.rows=a,this.model.data.newRowKey&&n.has(this.model.data.newRowKey)&&(this.model.data.newRowKey=void 0),this.model.models.selected.deselect(e),this.model.events.onRowsDeleted.send({rowKeys:e}),this.model.flags.noScrollOnFocus=!0,this.model.models.rows.updateRows(),t){let e=this.model.data.rows.length;e?this.model.models.focus.focusCell(Math.min(o,e-1),s):this.model.models.focus.clearFocus()}return!0};insertRowsAtSelection=e=>{if(!this.canAddRows)return[];let{rows:t,minRow:n}=this.model.models.focus.selectedCount;return this.addBlankRows((e??t)||1,n)};insertColumnsAtSelection=e=>{if(!this.canAddColumns)return[];let{columns:t,minCol:n}=this.model.models.focus.selectedCount;return this.addBlankColumns((e??t)||1,this.hostIndex(n))};deleteSelectedRows=()=>{let e=this.model.models.focus.getGridSelection();if(!e?.rows.length)return!1;let t=this.model.options.getRowKey;return this.deleteRows(e.rows.map(t),!0)};addColumns=(e,t)=>{if(!e.length)return[];let n=this.model.options.columns,r=e.every(e=>e.pinned===`right`)?n.length:n.length-E(n),i=t===void 0?r:Math.max(0,Math.min(t,r));if(this.model.options.onAddColumns?.({columns:e,index:i})===!1)return[];let a=[...n];return a.splice(i,0,...e),this.model.models.columns.setColumns(a),this.model.update({all:!0}),e};addBlankColumns=(e=1,t)=>{if(e<1)return[];let n=Array.from({length:e},()=>this.blankColumn());return this.addColumns(n,t)};deleteColumns=e=>{if(!e.length)return!1;let t=new Set(e),n=this.model.options.columns,r=n.filter(e=>t.has(String(e.key)));return!r.length||this.model.options.onDeleteColumns?.({columns:r,columnKeys:r.map(e=>String(e.key))})===!1?!1:(this.model.models.editing.isEditing&&this.model.models.editing.cancelEdit(),this.model.models.columns.setColumns(n.filter(e=>!t.has(String(e.key)))),this.model.update({all:!0}),!0)};deleteSelectedColumns=()=>{let e=this.model.models.focus.getGridSelection();if(!e?.columns.length)return!1;let t=e.columns.filter(e=>!T(e)).map(e=>String(e.key));return this.deleteColumns(t)};get canAddRows(){return!!this.model.options.canAddRows}get canDeleteRows(){return!!this.model.options.canDeleteRows}get canAddColumns(){return!!this.model.options.canAddColumns}get canDeleteColumns(){return!!this.model.options.canDeleteColumns}onContentKeyDown=e=>{if(!e.ctrlKey)return;let t=e.getModifierState?.(`NumLock`)??!1;if(e.code===`Insert`||e.code===`Numpad0`&&!t){if(e.shiftKey?!this.canAddColumns:!this.canAddRows)return;e.preventDefault(),e.shiftKey?this.insertColumnsAtSelection():this.insertRowsAtSelection();return}if(e.code===`Delete`||e.code===`NumpadDecimal`&&!t){if(e.shiftKey?!this.canDeleteColumns:!this.canDeleteRows)return;e.preventDefault(),e.shiftKey?this.deleteSelectedColumns():this.deleteSelectedRows()}};sourceIndex(e){let t=this.model.data.rows,n=this.model.options.rows;if(e>=t.length)return n.length;let r=n.indexOf(t[e]);return r<0?n.length:r}displayIndexOfKey(e){let t=this.model.data.rows,n=this.model.options.getRowKey,r=t.length-1;if(r<0)return-1;if(n(t[r])===e)return r;for(let i=0;i<r;i++)if(n(t[i])===e)return i;return-1}hostIndex(e){let t=this.model.data.columns[e];if(!t)return;let n=this.model.options.columns.indexOf(t);return n<0?void 0:n}blankRow(e){let t=this.model.options.newRow;if(t)return t(e);let n={},r=this.keyProperty();return r&&(n[r]=`new-${this.nextPlaceholder++}`),n}keyProperty(){return this.rowKeyProperty===void 0&&(this.rowKeyProperty=Ft(this.model.options.rows)??null),this.rowKeyProperty??void 0}blankColumn(){let e=this.model.options.newColumn,t=this.model.options.columns.length;if(e)return e(t);let n=this.nextPlaceholder++,r=new Set(this.model.options.columns.map(e=>String(e.key)));for(;r.has(`column${n}`);)n=this.nextPlaceholder++;return{key:`column${n}`,name:`Column ${n}`}}},Cn=[],wn=class{columns;sortColumn;filters;rows;selected;focus;editing;copyPaste;structure;constructor(e){this.columns=new ht(e),this.sortColumn=new xn(e),this.filters=new on(e),this.rows=new vn(e),this.selected=new yn(e),this.focus=new _n(e),this.editing=new Ct(e),this.copyPaste=new bt(e),this.structure=new Sn(e)}},Tn=class extends Fe{options;renderModel=null;data;events=new qe;models;flags={noScrollOnFocus:!1};constructor(e){super({sort:e.sort??void 0}),this.options=e,this.data=new We([],[]),this.models=new wn(this),this.models.columns.updateColumnsData(e.columns),this.models.rows.updateRows()}setRenderModel=e=>{this.renderModel=e};update=e=>{this.renderModel?.update(e)};requestRepaint=()=>{this.renderModel?.requestRepaint()};focusGrid=()=>{this.renderModel?.gridRef.current?.focus({preventScroll:!0})};gridRowToDataRow=e=>e-1;dataRowToGridRow=e=>e+1;rowKeyAt=e=>{let t=this.data.rows[e];return t===void 0?``:this.options.getRowKey(t)};cellContext=(e,t)=>{let n=this.data.rows[e],r=this.data.columns[t];if(n!==void 0&&r!==void 0)return{value:n[r.key],row:n,column:r,rowIndex:e,colIndex:t,rowKey:this.options.getRowKey(n),highlight:this.highlightText}};setRows=e=>{this.options.rows=e,this.models.rows.updateRows()};setColumns=e=>{this.models.columns.setColumns(e)};setSort=e=>{this.models.sortColumn.setSort(e)};setFilters=e=>{this.models.filters.setFilters(e)};setSearchString=e=>{this.options.searchString!==e&&(this.options.searchString=e,this.models.rows.refilterRows())};highlightText=e=>ze(e==null?``:String(e),this.data.searchWords);syncSearchWords=()=>{if(this.options.highlightSearch===!1){this.data.searchWords=Cn;return}let e=v(this.options.searchString),t=v(this.options.highlightString);this.data.searchWords=t.length?[...e,...t]:e};dispose(){this.events.clear(),this.data.onChange.clear(),this.renderModel=null,super.dispose()}},En=void 0,Dn=class{maxSize;buckets=new Map;keys=new WeakMap;count=0;_stats={hits:0,misses:0,released:0,discarded:0};constructor(e=2e3){this.maxSize=e}acquire=e=>{let t=this.takeFrom(e)??(e===En?this.takeFromAny():void 0);if(!t){this._stats.misses++;return}return this.keys.set(t,e),this._stats.hits++,t};setReuseKey=(e,t)=>{this.keys.set(e,t)};release=e=>{if(this.count>=this.maxSize)return this._stats.discarded++,!1;let t=this.keys.get(e),n=this.buckets.get(t);return n||(n=[],this.buckets.set(t,n)),n.push(e),this.count++,this._stats.released++,!0};get size(){return this.count}get stats(){return this._stats}resetStats(){this._stats={hits:0,misses:0,released:0,discarded:0}}clear(){this.buckets.clear(),this.count=0}takeFrom(e){let t=this.buckets.get(e);if(!t)return;let n=t.pop();return n&&this.count--,t.length||this.buckets.delete(e),n}takeFromAny(){for(let e of this.buckets.keys()){let t=this.takeFrom(e);if(t)return t}}},On=class{current;resolveAsync;async;constructor(e){this.current=e,this.async=new Promise(e=>{this.resolveAsync=t=>{this.resolveAsync=void 0,e(t)}})}ref=e=>{e&&this.current!==e&&(this.current=e,this.resolveAsync?this.resolveAsync(e):this.async=Promise.resolve(e))}},kn=24,An=120,jn=0,Mn={renderDt:0},Nn=class extends Fe{gridRef=new On(void 0);containerRef=new On(void 0);renderInfo=new On(me);offset={x:0,y:0};size={width:void 0,height:void 0};options;oldInput;pendingRerender;updateScheduled=!1;resizeObserver;_disposed=!1;scrollLost=!1;scrollEventCount=0;pendingScrollRow;constructor(e){super({...Mn}),this.options=e,this.inputChanged()}get disposed(){return this._disposed}getOptions(){return this.options}setOptions=e=>{this._disposed||(this.options={...this.options,...e},this.inputChanged()&&this.updateRenderInfo({all:!0}))};get rowCount(){return typeof this.options.rowCount==`function`?this.options.rowCount():this.options.rowCount}get columnCount(){return typeof this.options.columnCount==`function`?this.options.columnCount():this.options.columnCount}get scrollBarWidth(){let e=this.containerRef.current;return e?e.offsetWidth-e.clientWidth:0}get scrollBarHeight(){let e=this.containerRef.current;return e?e.offsetHeight-e.clientHeight:0}get measured(){if(!this.size.width||!this.size.height)return!1;let e=this.containerRef.current;return!!e&&!!(e.offsetHeight||e.offsetWidth)}get visibleRowCount(){let e=this.renderInfo.current.visible;return e?e.bottom-e.top+1:0}attach=({grid:e,container:t})=>{this._disposed||(this.gridRef.ref(e),this.containerRef.ref(t),typeof ResizeObserver<`u`&&(this.resizeObserver=new ResizeObserver(()=>this.checkSize()),this.resizeObserver.observe(e)),this.checkSize())};dispose(){this._disposed=!0,this.resizeObserver?.disconnect(),this.resizeObserver=void 0,this.pendingScrollRow=void 0,super.dispose()}requestRepaint=()=>{this._disposed||this.state.update(e=>{e.renderDt=Date.now()})};checkSize=()=>{this._disposed||this.onFrameResize()};onFrameResize=()=>{let e=this.gridRef.current,t={width:e?.offsetWidth,height:e?.offsetHeight};if(!t.width&&!t.height&&(this.offset.x||this.offset.y)&&(this.scrollLost=!0),(this.size.width!==t.width||this.size.height!==t.height||this.scrollBarWidth!==this.oldInput?.scrollBarWidth)&&(this.size=t,this.inputChanged()?this.updateRenderInfo({all:!0}):this.requestRepaint(),this.options.onResize)){let e=this.options.onResize;Promise.resolve().then(()=>e(t))}};inputChanged(){let e={rowCount:this.rowCount,columnCount:this.columnCount,rowHeight:this.options.rowHeight??24,columnWidth:this.options.columnWidth,renderCell:this.options.renderCell,stickyTop:this.options.stickyTop??0,stickyLeft:this.options.stickyLeft??0,stickyRight:this.options.stickyRight??0,stickyBottom:this.options.stickyBottom??0,overscanColumn:this.options.overscanColumn??jn,overscanRow:this.options.overscanRow??0,fitToWidth:this.options.fitToWidth??!1,size:this.size,offset:this.offset,scrollBarWidth:this.scrollBarWidth,scrollBarHeight:this.scrollBarHeight},t=this.oldInput||{};return this.oldInput=e,e.rowCount!==t.rowCount||e.columnCount!==t.columnCount||e.rowHeight!==t.rowHeight||e.columnWidth!==t.columnWidth||e.renderCell!==t.renderCell||e.stickyTop!==t.stickyTop||e.stickyLeft!==t.stickyLeft||e.stickyRight!==t.stickyRight||e.stickyBottom!==t.stickyBottom||e.overscanColumn!==t.overscanColumn||e.overscanRow!==t.overscanRow||e.fitToWidth!==t.fitToWidth||!e.size||!t.size||e.size.width!==t.size.width||e.size.height!==t.size.height||e.scrollBarWidth!==t.scrollBarWidth||e.scrollBarHeight!==t.scrollBarHeight}mergeRerenders=(e,t)=>{if(!e&&!t)return;let{all:n=!1,cells:r=[],rows:i=[],columns:a=[],fromRow:o}=e||{},{all:s=!1,cells:c=[],rows:l=[],columns:u=[],fromRow:d}=t||{};return{all:n||s,cells:[...r,...c],rows:[...i,...l],columns:[...a,...u],fromRow:o===void 0?d:d===void 0?o:Math.min(o,d)}};update=e=>{this._disposed||(this.pendingRerender=this.mergeRerenders(e,this.pendingRerender),e&&e.force?this.updateRenderInfo():this.updateScheduled||(this.updateScheduled=!0,Promise.resolve().then(()=>{this.updateScheduled=!1,!this._disposed&&this.pendingRerender&&this.updateRenderInfo()})))};updateRenderInfo=(e,t,n)=>{if(this._disposed)return;let{rowHeight:r=24,columnWidth:i,renderCell:a,stickyTop:o,stickyLeft:s,stickyRight:c,stickyBottom:l,overscanColumn:u=jn,overscanRow:d,fitToWidth:f=!1,onAdjustRenderRange:p}=this.options,m=this.mergeRerenders(e,this.pendingRerender),h=this.renderInfo.current===me?void 0:t,g=Ee(this.renderInfo.current,{rowCount:this.rowCount,columnCount:this.columnCount,rowHeight:r,columnWidth:i,renderCell:a,recycle:this.options.recycle,setReuseKey:this.options.setReuseKey,stickyTop:o??0,stickyLeft:s??0,stickyRight:c??0,stickyBottom:l??0,overscanColumn:u,overscanRow:d??0,fitToWidth:f,size:{width:this.size.width||0,height:this.size.height||0},offset:this.offset,scrollBarWidth:this.scrollBarWidth,scrollBarHeight:this.scrollBarHeight,rerender:m,direction:h,onAdjustRenderRange:p},this.options.whiteSpaceY,this.options.whiteSpaceX);if(g.innerSize.height<(this.size.height??0)&&this.offset.y>0){this.offset.y=0,this.updateRenderInfo(e,t,n);return}if(this.pendingRerender=void 0,g!==this.renderInfo.current){let e=this.renderInfo.current;this.renderInfo.ref(g),this.renderInfoChanged(n,e,g)}};async renderInfoChanged(e,t,n){e||this.requestRepaint();let r=await this.containerRef.async;!this._disposed&&r&&(this.renderInfo.current.input.scrollBarWidth!==this.scrollBarWidth||this.renderInfo.current.input.scrollBarHeight!==this.scrollBarHeight)&&this.requestRepaint(),this.notifyChanges(t,n)}notifyChanges(e,t){this.options.onInnerSizeChange&&(e.innerSize.height!==t.innerSize.height||e.innerSize.width!==t.innerSize.width)&&this.options.onInnerSizeChange(t.innerSize)}onScroll=e=>{let t=this.containerRef.current;if(!t||e&&e.target!==t||(this.scrollEventCount++,!t.offsetHeight&&!t.offsetWidth))return;let{scrollLeft:n,scrollTop:r}=t,i={x:n-this.offset.x,y:r-this.offset.y};this.offset={x:n,y:r},this.updateRenderInfo(void 0,i)};get scrollNeedsRestore(){return this.scrollLost}restoreScroll=()=>{let e=this.containerRef.current;e&&(!e.offsetHeight&&!e.offsetWidth||(this.scrollLost=!1,(this.offset.x!==0||this.offset.y!==0)&&(e.scrollLeft=this.offset.x,e.scrollTop=this.offset.y)))};revalidateScroll=()=>{if(this._disposed)return;let e=this.containerRef.current;if(!e||e.scrollLeft===this.offset.x&&e.scrollTop===this.offset.y)return;let t=this.scrollEventCount,n=()=>{this._disposed||this.scrollEventCount===t&&(this.pendingScrollRow||(this.scrollLost=!0,this.restoreScroll()))};typeof requestAnimationFrame==`function`?requestAnimationFrame(()=>requestAnimationFrame(n)):n()};async scrollTo(e,t){let n=await this.containerRef.async,r=ke(e,t,await this.renderInfo.async,this.offset);n&&(n.scrollLeft=r.x,n.scrollTop=r.y)}async scrollToRow(e,t=`nearest`){if(this._disposed)return;let n=await this.containerRef.async,r=await this.renderInfo.async;if(this._disposed)return;if(!this.measured){this.pendingScrollRow={row:e,align:t},this.requestRepaint();return}this.pendingScrollRow=void 0;let i=Oe(e,r,this.offset,t);n&&(n.scrollTop=i.y)}scrollToRowAfterPaint(e,t=`nearest`){this._disposed||(this.pendingScrollRow={row:e,align:t},this.requestRepaint())}flushPendingScroll(){if(this._disposed||!this.pendingScrollRow||!this.measured)return;let e=this.pendingScrollRow;this.pendingScrollRow=void 0,this.scrollLost=!1,this.scrollToRow(e.row,e.align)}async scrollToCol(e){let t=await this.containerRef.async,n=De(e,await this.renderInfo.async,this.offset);t&&(t.scrollLeft=n.x)}async scrollBy({x:e=0,y:t=0}){let n=await this.containerRef.async,r=await this.renderInfo.async,i=r.innerSize.width-r.input.size.width+r.input.scrollBarWidth,a=r.innerSize.height-r.input.size.height+r.input.scrollBarHeight;e!==0&&n&&(n.scrollLeft=Math.min(i,n.scrollLeft+e)),t!==0&&n&&(n.scrollTop=Math.min(a,n.scrollTop+t))}},W=e=>`${e}px`;function G(e,t,n){e.style.getPropertyValue(t)!==n&&e.style.setProperty(t,n)}function K(e,t){let n=document.createElement(`div`);return n.setAttribute(`data-type`,e),t&&(n.className=t),n}var Pn=new Set([`stickyLeft`,`stickyRight`,`stickyTopLeft`,`stickyTopRight`,`stickyBottomLeft`,`stickyBottomRight`]),Fn=class{host;options;model;pool=new Dn;root;container;area;regions;attached;unsubscribe;rafId;paintScheduled=!1;destroyed=!1;hostObserver;observedAncestors=[];hiddenDisplay=new WeakMap;loaned=new Set;lastInfo;lastScrollBarWidth=-1;lastScrollBarHeight=-1;_stats={paints:0,cellsAppended:0,cellsRemoved:0,lastPaintMs:0,totalPaintMs:0};constructor(e,t){this.host=e,this.options=t,this.root=K(`render-grid`),t.name&&this.root.setAttribute(`data-name`,t.name),t.className&&(this.root.className=t.className),this.container=K(`render-grid-scroll`,`avg-viewport`),this.container.tabIndex=-1,this.area=K(`render-grid-area`,`avg-cells-area`),this.regions={cells:this.area,stickyTop:K(`render-grid-sticky-top`,`avg-sticky-top`),stickyBottom:K(`render-grid-sticky-bottom`,`avg-sticky-bottom`),stickyLeft:K(`render-grid-sticky-left`,`avg-sticky-left`),stickyRight:K(`render-grid-sticky-right`,`avg-sticky-right`),stickyTopLeft:K(`render-grid-sticky-top-left`,`avg-sticky-top-left`),stickyTopRight:K(`render-grid-sticky-top-right`,`avg-sticky-top-right`),stickyBottomLeft:K(`render-grid-sticky-bottom-left`,`avg-sticky-bottom-left`),stickyBottomRight:K(`render-grid-sticky-bottom-right`,`avg-sticky-bottom-right`)},this.attached={cells:new Set,stickyTop:new Set,stickyBottom:new Set,stickyLeft:new Set,stickyRight:new Set,stickyTopLeft:new Set,stickyTopRight:new Set,stickyBottomLeft:new Set,stickyBottomRight:new Set},this.regions.stickyTop.append(this.regions.stickyTopLeft,this.regions.stickyTopRight),this.regions.stickyBottom.append(this.regions.stickyBottomLeft,this.regions.stickyBottomRight),this.area.append(this.regions.stickyTop,this.regions.stickyBottom,this.regions.stickyLeft,this.regions.stickyRight),this.container.append(this.area),this.root.append(this.container),this.applyStaticStyles(),this.host.append(this.root),this.model=new Nn({...t,recycle:this.acquireCell,setReuseKey:this.pool.setReuseKey}),this.container.addEventListener(`scroll`,this.model.onScroll,{passive:!0}),this.unsubscribe=this.model.state.subscribe(this.onModelChanged),this.model.attach({grid:this.root,container:this.container}),this.paint(),this.options.watchHost!==!1&&this.watchHost()}revalidate(){this.destroyed||this.model.revalidateScroll()}watchHost(){if(typeof MutationObserver>`u`)return;this.hostObserver??=new MutationObserver(this.onHostMutated);let e=[];for(let t=this.root.parentElement;t;t=t.parentElement)e.push(t);if(!(e.length===this.observedAncestors.length&&e.every((e,t)=>e===this.observedAncestors[t]))){this.hostObserver.disconnect();for(let t of e)this.hostObserver.observe(t,{childList:!0});this.observedAncestors=e}}onHostMutated=()=>{this.destroyed||(this.watchHost(),this.model.revalidateScroll())};get stats(){return{...this._stats,pool:this.pool.stats}}addOverlay(e,t=`content`){this.regions[t===`header`?`stickyTop`:`cells`].append(e)}setOptions(e){let t=`height`in e&&e.height!==this.options.height||`growToHeight`in e&&e.growToHeight!==this.options.growToHeight||`growToWidth`in e&&e.growToWidth!==this.options.growToWidth||`fitToWidth`in e&&e.fitToWidth!==this.options.fitToWidth;Object.assign(this.options,e),this.model.setOptions(e),e.className!==void 0&&(this.root.className=e.className),t&&(this.applyStaticStyles(),this.lastInfo=void 0,this.schedulePaint())}destroy(){if(!this.destroyed){this.destroyed=!0,this.container.removeEventListener(`scroll`,this.model.onScroll),this.hostObserver?.disconnect(),this.hostObserver=void 0,this.observedAncestors=[],this.unsubscribe?.(),this.unsubscribe=void 0,this.rafId!==void 0&&(cancelAnimationFrame(this.rafId),this.rafId=void 0),this.model.dispose(),this.pool.clear(),this.loaned.clear();for(let e of Object.keys(this.attached))this.attached[e].clear();this.root.remove()}}onModelChanged=e=>{this.schedulePaint()};schedulePaint(){this.destroyed||this.paintScheduled||(this.paintScheduled=!0,this.rafId=requestAnimationFrame(()=>{this.rafId=void 0,this.paintScheduled=!1,this.paint()}))}paint(){if(this.destroyed)return;let e=this.model.renderInfo.current,t=this.model.scrollBarWidth,n=this.model.scrollBarHeight;if(e===this.lastInfo&&t===this.lastScrollBarWidth&&n===this.lastScrollBarHeight){this.model.scrollNeedsRestore&&this.model.restoreScroll(),this.model.flushPendingScroll();return}this.lastInfo=e,this.lastScrollBarWidth=t,this.lastScrollBarHeight=n,this._stats.paints++;let r=performance.now();this.applyLayout(e,t,n);let i=new Set;for(let t of[e.cells,e.stickyTop,e.stickyBottom,e.stickyLeft,e.stickyRight,e.stickyTopLeft,e.stickyTopRight,e.stickyBottomLeft,e.stickyBottomRight])for(let e of t)e&&i.add(e);this.syncRegion(`cells`,e.cells,i),this.syncRegion(`stickyTop`,e.stickyTop,i),this.syncRegion(`stickyBottom`,e.stickyBottom,i),this.syncRegion(`stickyLeft`,e.stickyLeft,i),this.syncRegion(`stickyRight`,e.stickyRight,i),this.syncRegion(`stickyTopLeft`,e.stickyTopLeft,i),this.syncRegion(`stickyTopRight`,e.stickyTopRight,i),this.syncRegion(`stickyBottomLeft`,e.stickyBottomLeft,i),this.syncRegion(`stickyBottomRight`,e.stickyBottomRight,i),this.reclaimLoaned(i),this.model.scrollNeedsRestore&&this.model.restoreScroll(),this.model.flushPendingScroll(),this._stats.lastPaintMs=performance.now()-r,this._stats.totalPaintMs+=this._stats.lastPaintMs}resetStats(){this._stats={paints:0,cellsAppended:0,cellsRemoved:0,lastPaintMs:0,totalPaintMs:0},this.pool.resetStats()}syncRegion(e,t,n){let r=this.regions[e],i=this.attached[e],a=new Set;for(let e of t)e&&a.add(e);for(let e of i)!a.has(e)&&!n.has(e)&&this.evictCell(r,e);for(let e of a)i.has(e)||this.admitCell(r,e);this.attached[e]=a}acquireCell=e=>{let t=this.pool.acquire(e);return t&&this.loaned.add(t),t};reclaimLoaned(e){if(this.loaned.size){for(let t of this.loaned){if(e.has(t))continue;let n=t.parentElement;n?this.evictCell(n,t):this.pool.release(t)}this.loaned.clear()}}evictCell(e,t){if(this._stats.cellsRemoved++,this.options.onCellReleased?.(t),!this.options.keepCellsAttached){e.removeChild(t),this.pool.release(t);return}this.hiddenDisplay.set(t,t.style.display),t.style.display=`none`,t.removeAttribute(`data-row`),t.removeAttribute(`data-col`),t.setAttribute(`data-avg-pooled`,``),this.pool.release(t)||(e.removeChild(t),this.hiddenDisplay.delete(t))}admitCell(e,t){if(this._stats.cellsAppended++,t.parentElement!==e&&e.append(t),this.options.keepCellsAttached){let e=this.hiddenDisplay.get(t);e!==void 0&&(t.style.display=e,t.removeAttribute(`data-avg-pooled`),this.hiddenDisplay.delete(t))}this.options.onCellAttached?.(t)}applyStaticStyles(){let{growToHeight:e,growToWidth:t}=this.options;G(this.root,`flex`,`1 1 auto`),G(this.root,`position`,`relative`),G(this.root,`overflow`,`hidden`),G(this.root,`height`,this.options.height??(e?`unset`:`100px`)),G(this.root,`max-height`,e??`unset`),G(this.container,`overflow-y`,`auto`),G(this.container,`overflow-x`,this.options.fitToWidth?`hidden`:`auto`),G(this.container,`outline`,`none`),G(this.container,`overflow-anchor`,`none`),G(this.area,`overflow-anchor`,`none`),G(this.container,`max-height`,e??`unset`),G(this.container,`max-width`,t??`unset`),G(this.area,`position`,`relative`);for(let e of[`stickyTop`,`stickyBottom`])G(this.regions[e],`position`,`sticky`),G(this.regions[e],`z-index`,`2`);for(let e of[`stickyLeft`,`stickyRight`])G(this.regions[e],`position`,`sticky`),G(this.regions[e],`display`,`inline-flex`),G(this.regions[e],`z-index`,`1`);for(let e of[`stickyTopLeft`,`stickyTopRight`,`stickyBottomLeft`,`stickyBottomRight`])G(this.regions[e],`position`,`sticky`),G(this.regions[e],`display`,`inline-flex`),G(this.regions[e],`z-index`,`3`)}applyLayout(e,t,n){let{innerSize:r}=e,i=this.model.getOptions(),a=this.model.size.width??0,o=this.model.size.height??0,{growToHeight:s,growToWidth:c}=this.options;G(this.container,`width`,c?`unset`:W(a)),G(this.container,`height`,s?`unset`:W(o)),G(this.area,`width`,W(r.width)),G(this.area,`height`,W(r.height)),G(this.area,`--avg-sticky-bottom`,W(r.stickyBottomHeight));let l=W(a-r.stickyRightWidth-t);if(this.toggleRegion(`stickyTop`,!!i.stickyTop),i.stickyTop){let e=this.regions.stickyTop;G(e,`top`,`0px`),G(e,`width`,W(r.width)),G(e,`height`,W(r.stickyTopHeight))}if(this.toggleRegion(`stickyTopLeft`,!!(i.stickyTop&&i.stickyLeft)),i.stickyTop&&i.stickyLeft){let e=this.regions.stickyTopLeft;G(e,`left`,`0px`),G(e,`width`,W(r.stickyLeftWidth)),G(e,`height`,W(r.stickyTopHeight))}if(this.toggleRegion(`stickyTopRight`,!!(i.stickyTop&&i.stickyRight)),i.stickyTop&&i.stickyRight){let e=this.regions.stickyTopRight;G(e,`left`,l),G(e,`width`,W(r.stickyRightWidth)),G(e,`height`,W(r.stickyTopHeight))}if(this.toggleRegion(`stickyBottom`,!!i.stickyBottom),i.stickyBottom){let e=this.regions.stickyBottom;G(e,`top`,W(o-r.stickyBottomHeight-n)),G(e,`width`,W(r.width)),G(e,`height`,W(r.stickyBottomHeight))}if(this.toggleRegion(`stickyBottomLeft`,!!(i.stickyBottom&&i.stickyLeft)),i.stickyBottom&&i.stickyLeft){let e=this.regions.stickyBottomLeft;G(e,`left`,`0px`),G(e,`width`,W(r.stickyLeftWidth)),G(e,`height`,W(r.stickyBottomHeight))}if(this.toggleRegion(`stickyBottomRight`,!!(i.stickyBottom&&i.stickyRight)),i.stickyBottom&&i.stickyRight){let e=this.regions.stickyBottomRight;G(e,`left`,l),G(e,`width`,W(r.stickyRightWidth)),G(e,`height`,W(r.stickyBottomHeight))}if(this.toggleRegion(`stickyLeft`,!!i.stickyLeft),i.stickyLeft){let e=this.regions.stickyLeft;G(e,`left`,`0px`),G(e,`width`,W(r.stickyLeftWidth)),G(e,`height`,W(r.height-(r.stickyTopHeight+(r.stickyBottomHeight||20)))),G(e,`transform`,`translate(0, -${r.stickyBottomHeight}px)`)}if(this.toggleRegion(`stickyRight`,!!i.stickyRight),i.stickyRight){let e=this.regions.stickyRight;G(e,`left`,l),G(e,`width`,W(r.stickyRightWidth)),G(e,`height`,W(r.height-(r.stickyTopHeight+r.stickyBottomHeight))),G(e,`transform`,`translate(0, -${r.stickyBottomHeight}px)`)}}toggleRegion(e,t){G(this.regions[e],`display`,t?Pn.has(e)?`inline-flex`:`block`:`none`)}},In=`av-grid-styles`,Ln=`
[data-type="render-grid"].avg-grid {
    --avg-font-family: var(--p-font-family, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
    --avg-font-size: var(--p-font-base, 13px);
    --avg-text: var(--p-text, #202020);
    --avg-text-muted: var(--p-text-muted, #767676);
    --avg-bg: var(--p-bg, #ffffff);
    --avg-accent: var(--p-accent, #0078d4);

    --avg-border-color: color-mix(in srgb, var(--avg-text) 22%, transparent);
    /* The cell lines are not structural borders and should not read like them: they are
       texture between values, so they sit well below --avg-border-color. Persephone draws
       them from --color-border-light for exactly that reason, which is --p-border-light here. */
    --avg-grid-line: var(--p-border-light, color-mix(in srgb, var(--avg-text) 11%, transparent));
    /* The header band is chrome rather than content, so it takes the app's chrome surface —
       darker than the grid in a dark theme, not a tint of the grid's own background. */
    --avg-header-bg: var(--p-bg-dark, color-mix(in srgb, var(--avg-text) 7%, var(--avg-bg)));
    --avg-header-text: var(--avg-text);
    --avg-cell-bg: var(--avg-bg);
    --avg-cell-text: var(--avg-text);

    --avg-hover-bg: color-mix(in srgb, var(--avg-text) 6%, transparent);
    --avg-selection-bg: color-mix(in srgb, var(--avg-accent) 18%, transparent);
    --avg-selection-border: var(--avg-accent);
    /* The selection outline while the grid does not have focus. */
    --avg-selection-border-blurred: var(--avg-text-muted);
    /* A matched search word. Its own token rather than --avg-accent directly, because it is the
       one place the accent lands on *text* — a host that tints the grid to match its brand can
       need a different colour here than on a border, and cannot say so if the two are one. */
    --avg-search-match: var(--avg-accent);

    --avg-cell-padding-x: 4px;

    font-family: var(--avg-font-family);
    font-size: var(--avg-font-size);
    color: var(--avg-text);
    background-color: var(--avg-bg);
    outline: none;
}

/* ---------------------------------------------------------------- header */

.avg-grid .avg-header-cell {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    position: absolute;
    padding-left: var(--avg-cell-padding-x);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    background-color: var(--avg-header-bg);
    color: var(--avg-header-text);
    border-bottom: solid 1px var(--avg-grid-line);
    user-select: none;
    cursor: default;
}

.avg-grid .avg-header-title {
    overflow: hidden;
    text-overflow: ellipsis;
    margin-right: 4px;
}

/* The column-group band — the top half of the two-row header. Overlay divs, not pooled
   cells; see src/view/GroupHeader.ts. */
.avg-grid .avg-group-cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 0 var(--avg-cell-padding-x);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    background-color: var(--avg-header-bg);
    color: var(--avg-header-text);
    font-weight: 600;
    border-bottom: solid 1px var(--avg-grid-line);
    border-right: solid 1px var(--avg-grid-line);
    user-select: none;
    cursor: default;
}

.avg-grid .avg-flex-space {
    flex: 1 1 auto;
}

.avg-grid .avg-sort-icon {
    display: none;
    flex: 0 0 auto;
    align-items: center;
    color: var(--avg-text-muted);
    margin-right: 2px;
}

.avg-grid .avg-header-cell[data-sort] .avg-sort-icon {
    display: inline-flex;
}

/* The multi-sort position number, shown only when two or more columns sort. */
.avg-grid .avg-sort-pos {
    font-size: 9px;
    line-height: 1;
    align-self: flex-start;
    margin-left: -1px;
}

/* The resize grip: three faint dashes, revealed on hover over the right edge. */
.avg-grid .avg-header-cell[data-resizable="true"] {
    padding-right: 10px;
}

.avg-grid .avg-header-cell[data-resizable="true"]::after {
    content: "";
    cursor: col-resize;
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    inline-size: 10px;
}

.avg-grid .avg-header-cell[data-resizable="true"]:hover::after {
    background: linear-gradient(
        to bottom,
        transparent 0%,
        transparent 20%,
        var(--avg-border-color) 30%,
        transparent 40%,
        var(--avg-border-color) 50%,
        transparent 60%,
        var(--avg-border-color) 70%,
        transparent 80%,
        transparent 100%
    );
    background-size: 4px 100%;
    background-position: center;
    background-repeat: no-repeat;
}

/* A right-pinned header resizes from its LEFT edge — its right edge is anchored to the
   viewport — so the grip and the padding that clears it both flip sides. */
.avg-grid .avg-header-cell[data-resizable="true"][data-pinned="right"] {
    padding-right: var(--avg-cell-padding-x);
    padding-left: 10px;
}

.avg-grid .avg-header-cell[data-resizable="true"][data-pinned="right"]::after {
    inset-inline-end: auto;
    inset-inline-start: 0;
}

.avg-grid .avg-header-cell.avg-drag-source {
    opacity: 0.4;
}

.avg-grid .avg-header-cell.avg-drag-over {
    box-shadow: inset 2px 0 0 0 var(--avg-accent);
}

.avg-grid .avg-filter-button {
    display: none;
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    color: var(--avg-text-muted);
    background-color: var(--avg-header-bg);
}

.avg-grid .avg-header-cell:hover .avg-filter-button,
.avg-grid .avg-filter-button.avg-column-filtered {
    display: inline-flex;
}

.avg-grid .avg-filter-button.avg-column-filtered {
    color: var(--avg-accent);
}

/* ------------------------------------------------------------ data cells */

.avg-grid .avg-data-cell {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    position: absolute;
    padding: 0 var(--avg-cell-padding-x);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    background-color: var(--avg-cell-bg);
    color: var(--avg-cell-text);
    border-bottom: solid 1px var(--avg-grid-line);
    border-right: solid 1px var(--avg-grid-line);
    outline: none;
    user-select: none;
}

.avg-grid .avg-data-cell[data-col="0"] {
    border-left: solid 1px var(--avg-grid-line);
}

/*
 * .avg-cell-text — the wrapper around a text cell's content, plain and matched alike.
 *
 * It carries the truncation the cell above cannot. text-overflow applies to block containers, and
 * a data cell is inline-flex: a bare text node in it becomes an *anonymous flex item*, a generated
 * block box that inherits neither overflow nor text-overflow, while the overflow: hidden doing the
 * clipping is one level up on the flex container, which has no line box of its own to truncate. So
 * the text-overflow: ellipsis above did nothing for years — text was clipped mid-glyph, and in a
 * right-aligned column the overflow of a nowrap flex line moves to the *start* side, so a long
 * number silently lost its leading digits. The anonymous item is not reachable from CSS; only a
 * real element is. This is the same shape .avg-header-title and .avg-cell-select-value already use.
 *
 * min-width: 0 is the load-bearing declaration — a flex item will not shrink below its content
 * width without it, and then there is nothing to ellipsize.
 *
 * The wrapper is applied to *both* text shapes, and that is what preserves the older contract it
 * replaces: it was originally introduced for the matched shape only, for layout rather than
 * appearance, because flex discards the whitespace *between* items and a mark that split the text
 * rendered "Alan Dijkstra" as "AlanDijkstra". A marked cell must still lay out exactly like the
 * unmarked cell beside it — which it does, because now they have the same box. Anything given to
 * this rule must stay layout-neutral for the same reason: no colour, no padding, no font.
 */
.avg-grid .avg-data-cell > .avg-cell-text {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

/*
 * A word of the active search, inside a cell's text.
 *
 * The highlightSearch option picks between the three shapes by writing data-search-highlight
 * on the root — on the root, not on the mark, so choosing a shape costs nothing per cell and
 * changing it repaints nothing at all.
 *
 * The default is the reference's: colour alone. Which shape suits a theme turns entirely on its
 * accent, and this file is the wrong place to guess — a pale accent can read dimmer than the
 * text around it, where the tint helps, while a saturated one makes the tint a solid block
 * behind text of nearly its own colour and comes out worse than the default. Both have been
 * seen. So none of the three is recommended anywhere; the host looks and chooses.
 *
 * No weight change in any of them: bolding reflows the glyphs around the match, so the text
 * would shuffle sideways with every letter typed into the search box.
 */
.avg-grid .avg-search-match {
    color: var(--avg-search-match);
}

.avg-grid[data-search-highlight="background"] .avg-search-match,
.avg-grid[data-search-highlight="both"] .avg-search-match {
    background-color: color-mix(in srgb, var(--avg-search-match) 25%, transparent);
    border-radius: 2px;
}

.avg-grid[data-search-highlight="background"] .avg-search-match {
    color: inherit;
}

.avg-grid .avg-align-center {
    justify-content: center;
}

.avg-grid .avg-align-right {
    justify-content: flex-end;
}

/*
 * Every state tint is painted on ::before, an overlay covering the cell. Two reasons, both
 * from the reference: the cell's own background stays available for a host to set, and the
 * selection border can be drawn on the same layer as the selection fill without a second
 * element.
 */
.avg-grid .avg-data-cell::before {
    content: "";
    position: absolute;
    inset: 0;
    background-color: transparent;
    pointer-events: none;
}

.avg-grid .avg-row-selected::before,
.avg-grid .avg-data-cell.avg-in-selection::before {
    background-color: var(--avg-selection-bg);
}

.avg-grid .avg-data-cell.avg-row-hovered:not(.avg-editing)::after {
    content: "";
    position: absolute;
    inset: 0;
    background-color: var(--avg-hover-bg);
    pointer-events: none;
}

/* Selection edges — muted while the grid is blurred, accent-coloured once it has focus. */
.avg-grid .avg-data-cell.avg-in-selection-top:not(.avg-focused)::before {
    border-top: 1px solid var(--avg-selection-border-blurred);
}
.avg-grid .avg-data-cell.avg-in-selection-bottom:not(.avg-focused)::before {
    border-bottom: 1px solid var(--avg-selection-border-blurred);
}
.avg-grid .avg-data-cell.avg-in-selection-left:not(.avg-focused)::before {
    border-left: 1px solid var(--avg-selection-border-blurred);
}
.avg-grid .avg-data-cell.avg-in-selection-right:not(.avg-focused)::before {
    border-right: 1px solid var(--avg-selection-border-blurred);
}

.avg-grid:focus-within .avg-data-cell.avg-in-selection-top:not(.avg-focused)::before {
    border-top-color: var(--avg-selection-border);
}
.avg-grid:focus-within .avg-data-cell.avg-in-selection-bottom:not(.avg-focused)::before {
    border-bottom-color: var(--avg-selection-border);
}
.avg-grid:focus-within .avg-data-cell.avg-in-selection-left:not(.avg-focused)::before {
    border-left-color: var(--avg-selection-border);
}
.avg-grid:focus-within .avg-data-cell.avg-in-selection-right:not(.avg-focused)::before {
    border-right-color: var(--avg-selection-border);
}

.avg-grid .avg-data-cell.avg-focused::before {
    background-color: var(--avg-selection-bg);
    border: 1px solid var(--avg-selection-border-blurred);
}

.avg-grid:focus-within .avg-data-cell.avg-focused::before {
    border-color: var(--avg-selection-border);
}

/* Borderless variant — the static grid lines only. Selection and focus keep their borders. */
.avg-grid[data-cell-borders="off"] .avg-header-cell {
    border-bottom: none;
}

.avg-grid[data-cell-borders="off"] .avg-data-cell,
.avg-grid[data-cell-borders="off"] .avg-data-cell[data-col="0"] {
    border: none;
}

/* ------------------------------------------------------- select column */

/*
 * The checkbox column is an ordinary column whose render hook returns markup, so it needs no
 * layout of its own — only centring, a pointer cursor and the accent tint when checked. The
 * header's title span holds the select-all box, which is why the header rule targets padding.
 */
.avg-grid .avg-header-cell[data-column-key="--select-column--"] {
    padding-left: 0;
    justify-content: center;
}

/*
 * The title span normally holds text, so its inline content sits on a baseline with descender
 * space below it — which lifts an icon inside it a couple of pixels above the cell's centre.
 * Making the span a flex box takes the baseline out of it and centres the checkbox on both
 * axes, so it lines up with the boxes in the column below and with the labels beside it.
 */
.avg-grid .avg-header-cell[data-column-key="--select-column--"] .avg-header-title {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 0;
    overflow: visible;
}

/*
 * The header's flex spacer is what pushes the filter funnel to the right edge — and it also
 * absorbs every free pixel, so the justify-content above has nothing left to centre with. The
 * select column has no funnel, so the spacer has no job here.
 *
 * (No backticks in this file's comments: the whole sheet is one template literal.)
 */
.avg-grid .avg-header-cell[data-column-key="--select-column--"] .avg-flex-space {
    display: none;
}

/*
 * The row-selection checkbox, and the one an editable boolean cell carries. Both keep their 16x16
 * box even when empty, which for the boolean is what makes the first click on it land: the hit
 * target does not wait to be revealed. Neither is conditional on hover — the glyph inside a
 * boolean's box is chosen in the render path, where the grid already knows which cell the pointer
 * is on.
 */
.avg-grid .avg-select-box,
.avg-grid .avg-bool-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--avg-text-muted);
    cursor: pointer;
}

.avg-grid .avg-select-box.avg-checked,
.avg-grid .avg-bool-box.avg-checked {
    color: var(--avg-accent);
}

.avg-grid .avg-data-cell[data-column-key="--select-column--"],
.avg-grid .avg-header-cell[data-column-key="--select-column--"] {
    cursor: pointer;
}

/* -------------------------------------------------------------- editing */

/*
 * The editor fills its cell, inset by one pixel so the focus outline the cell already draws
 * stays visible around it. It inherits the grid's font rather than the browser's control font,
 * so the text does not jump size or family when a cell opens for editing.
 */
.avg-grid .avg-cell-editor {
    position: absolute;
    inset: 1px;
    box-sizing: border-box;
    width: auto;
    padding: 0 3px;
    margin: 0;
    border: none;
    outline: none;
    border-radius: 0;
    font: inherit;
    color: var(--avg-cell-text);
    background-color: var(--avg-cell-bg);
}

/*
 * The dropdown editor's closed state: the current value and a caret, filling the cell exactly
 * as the text editor does. It is a div rather than a select because the list it opens is drawn
 * by this library and themed by the same tokens as the grid — a native popup is drawn by the
 * platform and ignores every one of them.
 */
.avg-grid .avg-cell-select {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    cursor: default;
    user-select: none;
}

.avg-grid .avg-cell-select-value {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.avg-grid .avg-cell-select-caret {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    color: var(--avg-text-muted);
}

.avg-grid .avg-cell-select-caret > svg {
    width: 12px;
    height: 12px;
}

/* Wide enough to read whatever the column's width happens to be — matchAnchorWidth sets the
   width inline from the cell, and a 60px column would otherwise open a 60px list. */
.avg-cell-select-popover {
    min-width: 160px;
}

.avg-cell-select-popover .avg-popover-content {
    /* The list scrolls, not the panel around it — two scrollbars on one column of options. */
    overflow: hidden;
}

.avg-cell-select-list {
    padding: 0 2px;
}

/* The hover tint is suppressed over an open editor — see the ::after rule above. */
.avg-grid .avg-data-cell.avg-editing::before {
    border: 1px solid var(--avg-selection-border);
    background-color: transparent;
}

/* ---------------------------------------------------------------- pieces */

.avg-grid .avg-check-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: var(--avg-text-muted);
}

/*
 * The add-row and add-column affordances. Both sit outside the pooled cells: the row button in
 * the slack below the last row, the column button at the right end of the header band — so both
 * scroll with the content they extend, rather than floating over the viewport.
 */
.avg-grid .avg-add-row {
    position: absolute;
    bottom: calc(1px + var(--avg-sticky-bottom, 0px));
    left: 4px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    color: var(--avg-text-muted);
    opacity: 0.6;
}

/* Brighter, not different: these two are chrome, and the accent is reserved for state the grid
   is reporting — a sort, a filter, a selection edge. Persephone lights them the same way, from
   icon.light to icon.default. */
.avg-grid .avg-add-row:hover {
    opacity: 1;
    color: var(--p-text-strong, var(--avg-text));
}

/* extraElement — one host element after the last row, in the trailing slack.
   Positioned here, unlike an element a cell renderer returns: there the engine writes top and
   left and the host only has to add position, but nothing writes anything for this one, so a
   bare host element would lay out in flow among absolutely positioned cells and land at the
   top-left behind them — invisible and still hoverable. No colour, size or padding: only the
   host knows what the grid background is. One more class overrides it. */
.avg-grid .avg-extra {
    position: absolute;
    left: 0;
    right: 0;
    /* Above the footer band when there is one — the band overlays the area's bottom edge. */
    bottom: var(--avg-sticky-bottom, 0px);
}

.avg-grid .avg-add-column {
    position: absolute;
    top: 0;
    right: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 100%;
    padding: 0;
    border: none;
    background-color: var(--avg-header-bg);
    font: inherit;
    cursor: pointer;
    user-select: none;
    color: var(--avg-text-muted);
    opacity: 0.6;
}

.avg-grid .avg-add-column:hover {
    opacity: 1;
    color: var(--p-text-strong, var(--avg-text));
}

/* --- Popover ---------------------------------------------------------------------------
   Mounted on document.body, so it is outside the grid root and inherits none of the tokens
   defined there. It repeats the theme contract rather than reaching for it: a popover has to
   look like it belongs to the grid it was opened from, and both read the same --p-* tokens. */
.avg-popover {
    --avg-font-family: var(--p-font-family, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
    --avg-font-size: var(--p-font-base, 13px);
    --avg-text: var(--p-text, #202020);
    --avg-text-muted: var(--p-text-muted, #767676);
    --avg-bg: var(--p-bg, #ffffff);
    --avg-accent: var(--p-accent, #0078d4);
    --avg-border-color: color-mix(in srgb, var(--avg-text) 22%, transparent);
    --avg-hover-bg: color-mix(in srgb, var(--avg-text) 6%, transparent);
    --avg-selection-bg: color-mix(in srgb, var(--avg-accent) 18%, transparent);
    /* A menu row is picked, not marked. A checklist can tint its rows — several are on at once
       and the text under them has to stay readable — but exactly one menu row is under the
       pointer, and the platform draws that one in the full selection colour. */
    --avg-menu-selection-bg: var(--p-selection-bg, var(--avg-accent));
    --avg-menu-selection-text: var(--p-selection-text, #ffffff);
    /* Apply is the same gesture as picking a menu row, so it takes the same pair. The accent is
       a *line* colour — dark enough to read against a light background — and filling a button
       with it left the label, which was --avg-bg, near-black on dark blue in a dark theme. */
    --avg-button-primary-bg: var(--p-selection-bg, var(--avg-accent));
    --avg-button-primary-text: var(--p-selection-text, var(--avg-bg));

    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
    font-family: var(--avg-font-family);
    font-size: var(--avg-font-size);
    color: var(--avg-text);
    background-color: var(--avg-bg);
    border: solid 1px var(--avg-border-color);
    border-radius: 6px;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--avg-text) 25%, transparent);
    outline: none;
}

.avg-popover-content {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
}

.avg-popover-resize {
    position: absolute;
    right: 1px;
    bottom: 1px;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: nwse-resize;
    color: var(--avg-text-muted);
    opacity: 0.6;
    user-select: none;
    touch-action: none;
    z-index: 1;
}

.avg-popover-resize:hover {
    opacity: 1;
}

.avg-popover-resize > svg {
    width: 12px;
    height: 12px;
}

/* Opened above its anchor, the popover grows upward, so the grip moves to the top corner. */
.avg-popover[data-placement^="top"] .avg-popover-resize {
    top: 1px;
    bottom: auto;
    cursor: nesw-resize;
    transform: rotate(-90deg);
}

/* --- Menu ------------------------------------------------------------------------------
   A menu is a popover with rows in it, so everything above applies and this is only the rows.
   The list scrolls rather than the popover content, so a search box stays put above it. */
.avg-menu .avg-popover-content {
    overflow: hidden;
}

.avg-menu-list {
    flex: 1 1 auto;
    min-height: 0;
    padding: 4px 0;
    overflow: auto;
}

.avg-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    /* The reference's ROW_HEIGHT — kept in step with MENU_ROW_HEIGHT in Menu.ts, which is what
       a PageDown counts by. */
    height: 26px;
    padding: 0 8px;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
}

/* One highlight, not two: the keyboard's active row and the pointer's hover are the same
   state, so moving the pointer after using the arrows does not leave two rows lit. */
.avg-menu-item:hover,
.avg-menu-item[data-active],
.avg-menu-item[data-submenu-open] {
    background-color: var(--avg-menu-selection-bg);
    color: var(--avg-menu-selection-text);
}

/* The row's furniture follows its label onto the highlight. A hotkey or a chevron left at
   --avg-text-muted is barely legible against a solid accent, and the check mark left at the
   accent itself disappears into it entirely. */
.avg-menu-item:hover .avg-menu-hotkey,
.avg-menu-item:hover .avg-menu-icon,
.avg-menu-item:hover .avg-menu-chevron,
.avg-menu-item:hover .avg-menu-check,
.avg-menu-item[data-active] .avg-menu-hotkey,
.avg-menu-item[data-active] .avg-menu-icon,
.avg-menu-item[data-active] .avg-menu-chevron,
.avg-menu-item[data-active] .avg-menu-check,
.avg-menu-item[data-submenu-open] .avg-menu-hotkey,
.avg-menu-item[data-submenu-open] .avg-menu-icon,
.avg-menu-item[data-submenu-open] .avg-menu-chevron,
.avg-menu-item[data-submenu-open] .avg-menu-check {
    color: var(--avg-menu-selection-text);
}

.avg-menu-item[data-start-group] {
    margin-top: 4px;
    border-top: solid 1px var(--avg-border-color);
}

.avg-menu-item[data-disabled] {
    color: var(--avg-text-muted);
    cursor: default;
}

/* A disabled row does not light up, so it also does not take the highlight's text colour. */
.avg-menu-item[data-disabled]:hover,
.avg-menu-item[data-disabled]:hover .avg-menu-hotkey,
.avg-menu-item[data-disabled]:hover .avg-menu-icon,
.avg-menu-item[data-disabled]:hover .avg-menu-chevron,
.avg-menu-item[data-disabled]:hover .avg-menu-check {
    background-color: transparent;
    color: var(--avg-text-muted);
}

/* A secondary action sharing the menu with the primary ones — the column items under the row
   ones. Dimmed until it is the row being pointed at, so the menu reads in two tiers. */
.avg-menu-item[data-minor]:not(:hover):not([data-active]) {
    color: var(--avg-text-muted);
}

.avg-menu-label {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
}

.avg-menu-hotkey {
    flex: 0 0 auto;
    margin-left: 24px;
    color: var(--avg-text-muted);
}

.avg-menu-icon,
.avg-menu-chevron,
.avg-menu-check {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--avg-text-muted);
}

.avg-menu-item > svg,
.avg-menu-icon > svg,
.avg-menu-check > svg {
    width: 16px;
    height: 16px;
}

.avg-menu-chevron > svg {
    width: 12px;
    height: 12px;
}

.avg-menu-check {
    color: var(--avg-accent);
}

/* The search box is the list's, so it reuses the list's own input rule and only needs the
   token block a menu popover already carries. */
.avg-menu .avg-menu-search {
    flex: 0 0 auto;
}

.avg-menu .avg-menu-search:focus,
.avg-menu .avg-menu-search:focus-visible {
    border-color: var(--avg-accent);
    outline: none;
}

/* --- VirtualList -----------------------------------------------------------------------
   Mounted wherever its caller puts it — inside a popover, usually — so like the popover it
   defines its own tokens rather than inheriting the grid's. */
.avg-list {
    --avg-text: var(--p-text, #202020);
    --avg-text-muted: var(--p-text-muted, #767676);
    --avg-bg: var(--p-bg, #ffffff);
    --avg-accent: var(--p-accent, #0078d4);
    --avg-border-color: color-mix(in srgb, var(--avg-text) 22%, transparent);
    --avg-hover-bg: color-mix(in srgb, var(--avg-text) 6%, transparent);
    --avg-selection-bg: color-mix(in srgb, var(--avg-accent) 18%, transparent);

    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    color: var(--avg-text);
}

/* Width stated rather than stretched. An input in a flex column does not fill it: its width:auto
   resolves to the intrinsic size a text field has, so align-items:stretch never applies and the
   box sits at ~120px however wide the popover is. The calc is the two 4px margins. */
.avg-list-search {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: calc(100% - 8px);
    margin: 4px;
    padding: 1px 6px;
    /* After the shorthand, which would otherwise reset it. */
    font: inherit;
    line-height: 18px;
    color: var(--avg-text);
    background-color: transparent;
    border: solid 1px var(--avg-border-color);
    border-radius: 4px;
    outline: none;
}

/* The 1px border is the focus indicator. A host's own :focus-visible ring would sit outside it
   at whatever width that host chose — 2px on a Persephone board — and a bare .avg-list-search
   ties with a bare :focus-visible on specificity, so it loses on source order. Scoped to the
   list to outrank it, and both states named because the host may style either. */
.avg-list .avg-list-search:focus,
.avg-list .avg-list-search:focus-visible {
    border-color: var(--avg-accent);
    outline: none;
}

.avg-list-body {
    flex: 1 1 auto;
    min-height: 0;
}

/* The rows are engine-rendered, so the item rule has to cover both the pooled cells and the
   select-all row, which is an ordinary element above the scroll area. */
.avg-list-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    box-sizing: border-box;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
    user-select: none;
}

/* The engine positions its rows; it does not position them *absolutely* — that is the
   stylesheet's job, exactly as it is for .avg-data-cell. Without this the rows lay out in
   flow, which looks right at the top of the list only because each row's inline width fills the
   container and forces a wrap, and then shows an empty band everywhere below: the top the
   engine wrote is ignored, so scrolling reveals content nobody positioned. Scoped to the grid
   region, so the select-all row above it stays in flow. */
.avg-list-grid .avg-list-item {
    position: absolute;
}

.avg-list-all {
    display: flex;
    flex: 0 0 auto;
    height: 24px;
    border-bottom: solid 1px var(--avg-border-color);
    color: var(--avg-text-muted);
}

.avg-list-item:hover {
    background-color: var(--avg-hover-bg);
}

.avg-list-item[data-selected] {
    background-color: var(--avg-selection-bg);
}

.avg-list-item[data-active] {
    outline: solid 1px var(--avg-accent);
    outline-offset: -1px;
}

.avg-list-item[data-disabled] {
    color: var(--avg-text-muted);
    cursor: default;
    opacity: 0.6;
}

.avg-list-label {
    overflow: hidden;
    text-overflow: ellipsis;
}

.avg-list-box {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    color: var(--avg-text-muted);
}

.avg-list-box.avg-checked {
    color: var(--avg-accent);
}

.avg-list-box > svg {
    width: 14px;
    height: 14px;
}

/* A single-pick list has no checkboxes — the row highlight is the selection. */
.avg-list:not([data-multiple]) .avg-list-box {
    display: none;
}

.avg-list-empty {
    padding: 8px;
    color: var(--avg-text-muted);
    text-align: center;
}

/* --- Filter popover --------------------------------------------------------------------
   The body of a filter popover: the checklist, then the two buttons. It sets a min-width and
   lets the popover take its width from it, so a narrow column still gets a readable list. */
.avg-filter-popover .avg-popover-content {
    /* The content scrolls nothing itself — the list inside it does, and a scrollbar on both
       would let the buttons scroll out of reach. */
    overflow: hidden;
}

.avg-filter-content {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
}

.avg-filter-list {
    padding: 0 2px;
}

.avg-filter-buttons {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    /* The extra 14px on the right is the resize grip's own square, which sits at the bottom
       corner with a z-index above this row. Without it "Clear" ends up under the grip: the
       press that means "resize" lands on the button, and the press that means "Clear" is
       taken by the grip. */
    padding: 6px 20px 6px 6px;
    border-top: solid 1px var(--avg-border-color);
}

/* A custom filter body is host DOM, so the grid styles only the space around it: the panel
   scrolls if the body is taller than the room under its anchor, and the buttons keep the row they
   have under the checklist. No grip on this popover, so the 20px reserved for one comes back. */
.avg-custom-filter-content > .avg-filter-buttons {
    padding: 6px;
}

.avg-custom-filter-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 8px;
}

.avg-button {
    padding: 3px 12px;
    font: inherit;
    color: var(--avg-text);
    background-color: transparent;
    border: solid 1px var(--avg-border-color);
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
}

.avg-button:hover:not(:disabled) {
    border-color: var(--avg-accent);
    color: var(--avg-accent);
}

.avg-button-primary {
    color: var(--avg-button-primary-text, var(--avg-bg));
    background-color: var(--avg-button-primary-bg, var(--avg-accent));
    border-color: var(--avg-button-primary-bg, var(--avg-accent));
}

.avg-button-primary:hover:not(:disabled) {
    color: var(--avg-button-primary-text, var(--avg-bg));
    opacity: 0.85;
}

.avg-button:disabled {
    opacity: 0.45;
    cursor: default;
}

.avg-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    color: inherit;
    background-color: transparent;
    border: none;
    border-radius: 3px;
    cursor: pointer;
}

.avg-icon-button:hover {
    color: var(--avg-accent);
}

/* Lit while its own popover is open — set from the model, so a repaint keeps it. */
.avg-grid .avg-filter-button.avg-filter-open {
    display: inline-flex;
    color: var(--avg-accent);
}

/* --- Filter bar ------------------------------------------------------------------------
   The bar can be mounted anywhere on the page, not only above its grid, so it carries its own
   copy of the token block for the same reason .avg-popover does: it cannot count on inheriting
   from a .avg-grid ancestor because it may not have one. */
.avg-filter-bar {
    --avg-font-family: var(--p-font-family, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
    --avg-font-size: var(--p-font-base, 13px);
    --avg-text: var(--p-text, #202020);
    --avg-text-muted: var(--p-text-muted, #767676);
    --avg-bg: var(--p-bg, #ffffff);
    --avg-accent: var(--p-accent, #0078d4);
    --avg-border-color: color-mix(in srgb, var(--avg-text) 22%, transparent);
    /* The same two the header band uses: the bar is the grid's chrome, and reading as a
       separate surface is the point of it. */
    --avg-header-bg: var(--p-bg-dark, color-mix(in srgb, var(--avg-text) 7%, var(--avg-bg)));
    --avg-grid-line: var(--p-border-light, color-mix(in srgb, var(--avg-text) 11%, transparent));
    --avg-hover-bg: color-mix(in srgb, var(--avg-text) 6%, transparent);

    box-sizing: border-box;
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    padding: 3px 4px;
    font-family: var(--avg-font-family);
    font-size: var(--avg-font-size);
    color: var(--avg-text);
    background-color: var(--avg-header-bg);
    border-bottom: solid 1px var(--avg-grid-line);
}

/* No filters, no bar — not an empty strip of chrome, and no height taken from the grid. */
.avg-filter-bar.avg-filter-bar-empty {
    display: none;
}

.avg-filter-bar-chips {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
}

.avg-filter-chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    background-color: var(--avg-bg);
    border: solid 1px var(--avg-border-color);
    border-radius: 4px;
}

.avg-filter-chip-open,
.avg-filter-chip:hover {
    border-color: var(--avg-accent);
}

.avg-filter-chip-body {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding: 1px 2px 1px 8px;
    cursor: pointer;
    user-select: none;
}

.avg-filter-chip-name {
    flex: 0 0 auto;
    color: var(--avg-text-muted);
}

/* The one part that may not fit: the label is already truncated to a character budget, and
   this catches what a wide font or a long single value gets past it. */
.avg-filter-chip-values {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.avg-filter-chip-caret {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    padding: 0 2px;
    color: var(--avg-text-muted);
}

.avg-filter-chip-open .avg-filter-chip-caret {
    color: var(--avg-accent);
}

.avg-filter-chip-remove {
    flex: 0 0 auto;
    margin-right: 2px;
    border-left: solid 1px var(--avg-border-color);
    border-radius: 0;
    color: var(--avg-text-muted);
}

.avg-filter-bar-clear {
    flex: 0 0 auto;
    color: var(--avg-text-muted);
}

.avg-filter-bar .avg-icon-button > svg {
    width: 14px;
    height: 14px;
}

/* --- Filter bar mounted by the grid ------------------------------------------------------
   filterBar: true puts the bar and the grid in a column, and the grid takes what is left.
   The grid's own height is written inline by the engine, so it is set to auto here and the
   flex line decides it — a percentage would resolve against the wrapper and overflow by
   exactly the height of the bar. */
.avg-grid-wrap {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    /* The same flex the engine writes on the grid root, because the wrapper takes the root's
       place as the host's child and has to fill it the same way. Without this the wrapper is a
       flex item at its default 0 1 auto, sizes itself to the grid's intrinsic width, and a
       grid that used to fill a flex-row container renders in a column down the left. */
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
}

.avg-grid-wrap > .avg-grid {
    flex: 1 1 auto;
    min-height: 0;
}

.avg-grid .avg-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--avg-text-muted);
    pointer-events: none;
}
`;function Rn(e){let t=e??(typeof document<`u`?document:void 0);if(!t||t.getElementById(`av-grid-styles`))return;let n=t.createElement(`style`);n.id=In,n.textContent=Ln,t.head.prepend(n)}var zn=`<span class="avg-check-icon">${Ze}</span>`,Bn=`<span class="avg-bool-box avg-checked" data-type="bool-toggle">${zn}</span>`,Vn=`<span class="avg-bool-box" data-type="bool-toggle"></span>`,Hn=`<span class="avg-bool-box avg-checked" data-type="bool-toggle">${Qe}</span>`,Un=`<span class="avg-bool-box" data-type="bool-toggle">${$e}</span>`,Wn=new WeakMap,q=new WeakMap,Gn=`avg-cell-text`;function Kn(e,t,n){let r=n?null:e.firstElementChild;(!r||r.className!==Gn)&&(e.textContent=``,r=document.createElement(`span`),r.className=Gn,e.appendChild(r)),Ae(r,t)}function J(e,t,n=`data-cell`){return Wn.get(e)===t&&e.getAttribute(`data-type`)===n?!1:(e.textContent=``,Wn.set(e,t),!0)}function qn(e,t){return e.align===`center`?` avg-align-center`:e.align===`right`?` avg-align-right`:e.align===`left`?``:typeof t==`boolean`||e.dataType===`boolean`&&!t?` avg-align-center`:typeof t==`number`?` avg-align-right`:``}function Jn(e,t){let n=e.data.columns[t.col],r=e.gridRowToDataRow(t.row),i=e.data.rows[r];if(!n||i===void 0)return;let a=t.previous??t.recycle?.()??document.createElement(`div`),o=i[n.key],s=`avg-data-cell`+qn(n,o);e.data.hovered.row===r&&(s+=` avg-row-hovered`);let c=e.models.editing,l=c.isEditingCell(r,t.col);l&&(s+=` avg-editing`),s+=e.models.selected.rowClass(r),s+=e.models.focus.focusClass(t.col,r);let u=n.cellClass,d=e.options.onCellClass,f;(n.render||d||typeof u==`function`)&&(f={value:o,row:i,column:n,rowIndex:r,colIndex:t.col,rowKey:e.options.getRowKey(i),highlight:e.highlightText}),typeof u==`string`?s+=` ${u}`:u&&f&&(s=P(s,u(f))),d&&f&&(s=P(s,d(f)));let p=e.options.rowClass;if(p&&(s=P(s,p({row:i,rowIndex:r,rowKey:e.options.getRowKey(i)}))),a.className!==s&&(a.className=s),a.setAttribute(`data-type`,`data-cell`),a.setAttribute(`data-row`,String(r)),a.setAttribute(`data-col`,String(t.col)),a.setAttribute(`data-column-key`,String(n.key)),a.setAttribute(`role`,`gridcell`),a.setAttribute(`aria-rowindex`,String(r+2)),a.setAttribute(`aria-colindex`,String(t.col+1)),l){let e=c.editorElement();if(e)return e.parentElement!==a&&(J(a,`editor`),a.appendChild(e),c.editorMounted()),F(a,t.style),a}else c.ownsCell(a)&&c.releaseCell();if(n.render&&f){let e=n.render(f);e==null?Kn(a,``,J(a,`text`)):typeof e==`string`?(J(a,`html`)&&q.delete(a),q.get(a)!==e&&(a.innerHTML=e,q.set(a,e))):(J(a,`node`),a.textContent=``,a.appendChild(e))}else if(n.dataType===`boolean`){J(a,`bool`);let i=x(o),s;s=!c.canEdit(n)||n.editor?i?zn:``:e.data.hovered.row===r&&e.data.hovered.col===t.col?i?Hn:Un:i?Bn:Vn,a.innerHTML!==s&&(a.innerHTML=s)}else{let t=Yn(n,i,o),r=e.data.searchWords,s=r.length?He(t,r):null;s===null?Kn(a,t,J(a,`text`)):(J(a,`match`)&&q.delete(a),q.get(a)!==s&&(a.innerHTML=s,q.set(a,s)))}return F(a,t.style),a}function Yn(e,t,n){if(e.formatValue||e.displayFormat){let n=D(e,t);return n==null?``:String(n)}return n==null?``:typeof n==`string`?n:typeof n==`number`?String(n):n instanceof Date?f(n):String(n)}function Xn(e,t){let n=e.data.columns[t.col],r=e.gridRowToDataRow(t.row)-e.data.rows.length,i=e.options.footerRows?.[r];if(!n||i===void 0)return;let a=t.previous??t.recycle?.()??document.createElement(`div`),o=e.models.editing;o.ownsCell(a)&&o.releaseCell();let s=i[n.key],c=`avg-footer-`+r,l=`avg-data-cell avg-footer-cell`+qn(n,s),u=n.cellClass,d;(n.render||typeof u==`function`)&&(d={value:s,row:i,column:n,rowIndex:r,colIndex:t.col,rowKey:c,highlight:e.highlightText}),typeof u==`string`?l+=` ${u}`:u&&d&&(l=P(l,u(d)));let f=e.options.footerRowClass;if(f&&(l=P(l,f({row:i,rowIndex:r,rowKey:c}))),a.className!==l&&(a.className=l),a.setAttribute(`data-type`,`footer-cell`),a.setAttribute(`data-col`,String(t.col)),a.setAttribute(`data-column-key`,String(n.key)),a.setAttribute(`data-footer-row`,String(r)),a.setAttribute(`role`,`gridcell`),a.setAttribute(`aria-readonly`,`true`),a.setAttribute(`aria-rowindex`,String(e.data.rows.length+r+2)),a.setAttribute(`aria-colindex`,String(t.col+1)),a.removeAttribute(`data-row`),n.render&&d){let e=n.render(d);e==null?Kn(a,``,J(a,`text`,`footer-cell`)):typeof e==`string`?(J(a,`html`,`footer-cell`)&&q.delete(a),q.get(a)!==e&&(a.innerHTML=e,q.set(a,e))):(J(a,`node`,`footer-cell`),a.textContent=``,a.appendChild(e))}else if(n.dataType===`boolean`){J(a,`bool`,`footer-cell`);let e=x(s)?zn:``;a.innerHTML!==e&&(a.innerHTML=e)}else Kn(a,Yn(n,i,s),J(a,`text`,`footer-cell`));return F(a,t.style),a}var Zn=new WeakMap;function Qn(e){e.textContent=``,e.removeAttribute(`style`);let t=document.createElement(`span`);t.className=`avg-sort-icon`;let n=document.createElement(`span`);n.className=`avg-header-title`,n.appendChild(document.createTextNode(``));let r=document.createElement(`span`);r.className=`avg-flex-space`;let i=document.createElement(`button`);i.className=`avg-filter-button`,i.type=`button`,i.tabIndex=-1,i.setAttribute(`data-type`,`filter-button`),i.innerHTML=Xe,e.append(t,n,r,i);let a={sort:t,title:n,space:r,filter:i};return Zn.set(e,a),a}function $n(e,t){let n=e.data.columns[t.col];if(!n)return;let r=t.previous??t.recycle?.()??document.createElement(`div`),i=Zn.get(r);(!i||r.getAttribute(`data-type`)!==`header-cell`)&&(i=Qn(r));let a=String(n.key),o=`avg-header-cell`;e.flags.dragColumnKey===a&&(o+=` avg-drag-source`),e.flags.dragOverColumnKey===a&&(o+=` avg-drag-over`);let s=n.headerClass;typeof s==`string`?o+=` ${s}`:s&&(o=P(o,s({column:n,colIndex:t.col}))),r.className!==o&&(r.className=o),r.setAttribute(`data-type`,`header-cell`),r.setAttribute(`data-row`,`0`),r.setAttribute(`data-col`,String(t.col)),r.setAttribute(`data-column-key`,a),r.setAttribute(`role`,`columnheader`),r.setAttribute(`aria-colindex`,String(t.col+1));let c=T(n);t.col>=e.data.columns.length-e.data.stickyRightCount?r.setAttribute(`data-pinned`,`right`):c?r.setAttribute(`data-pinned`,`left`):r.removeAttribute(`data-pinned`);let l=n.resizable!==!1&&!c;r.setAttribute(`data-resizable`,l?`true`:`false`),r.draggable=!c&&!e.data.hasGroups;let u=S(e.state.get().sort),d=u.findIndex(e=>e.key===a);if(d>=0){let e=u[d].direction;r.setAttribute(`data-sort`,e),d===0?r.setAttribute(`aria-sort`,e===`asc`?`ascending`:`descending`):r.removeAttribute(`aria-sort`);let t=u.length>1?`<span class="avg-sort-pos">${d+1}</span>`:``;i.sort.innerHTML=(e===`asc`?Je:Ye)+t}else r.removeAttribute(`data-sort`),r.removeAttribute(`aria-sort`),i.sort.firstChild&&(i.sort.textContent=``);let f=n.headerRender?.({column:n,colIndex:t.col});f==null?(Ae(i.title,n.name??String(n.key)),r.title=n.name??String(n.key)):typeof f==`string`?(i.title.innerHTML=f,r.removeAttribute(`title`)):(i.title.textContent=``,i.title.appendChild(f),r.removeAttribute(`title`));let p=n.filterType!==null&&!c&&!e.options.disableFiltering;i.filter.style.display=p?``:`none`;let m=e.options.filters?.some(e=>e.columnKey===String(n.key));i.filter.classList.toggle(`avg-column-filtered`,!!m),i.filter.classList.toggle(`avg-filter-open`,e.flags.filterPopover?.columnKey===a);let h=t.style;if(e.data.hasGroups&&n.group!==void 0){let t=e.options.rowHeight;h={...h,top:h.top+t,height:h.height-t}}return F(r,h),r}var Y=8,er=100,tr=class{root;content;options;doc;placement;offset;open=!1;resolve;promise;manualSize;previousFocus=null;observer;resolvedPlacement;constructor(e){if(this.options=e,this.placement=e.placement??`bottom-start`,this.resolvedPlacement=this.placement,this.offset=e.offset??[0,4],this.manualSize=e.size,this.doc=e.document??(e.anchor instanceof Element?e.anchor.ownerDocument:document),this.root=this.doc.createElement(`div`),this.root.className=`avg-popover${e.className?` ${e.className}`:``}`,this.root.setAttribute(`data-type`,`popover`),this.root.tabIndex=-1,this.content=this.doc.createElement(`div`),this.content.className=`avg-popover-content`,this.root.appendChild(this.content),e.resizable){let e=this.doc.createElement(`div`);e.className=`avg-popover-resize`,e.setAttribute(`data-type`,`popover-resize-handle`),e.innerHTML=et,e.addEventListener(`pointerdown`,this.onResizePointerDown),this.root.appendChild(e)}}get isOpen(){return this.open}show(){return this.open?this.promise:(this.open=!0,this.promise=new Promise(e=>{this.resolve=e}),this.previousFocus=this.doc.activeElement,this.doc.body.appendChild(this.root),this.reposition(),this.options.autoFocus!==!1&&this.root.focus({preventScroll:!0}),this.doc.addEventListener(`pointerdown`,this.onDocumentPointerDown,!0),this.doc.addEventListener(`keydown`,this.onDocumentKeyDown,!0),this.doc.defaultView?.addEventListener(`scroll`,this.reposition,!0),this.doc.defaultView?.addEventListener(`resize`,this.reposition),typeof ResizeObserver<`u`&&(this.observer=new ResizeObserver(()=>this.reposition()),this.observer.observe(this.content)),this.promise)}close=e=>{if(!this.open)return;this.open=!1,this.doc.removeEventListener(`pointerdown`,this.onDocumentPointerDown,!0),this.doc.removeEventListener(`keydown`,this.onDocumentKeyDown,!0),this.doc.defaultView?.removeEventListener(`scroll`,this.reposition,!0),this.doc.defaultView?.removeEventListener(`resize`,this.reposition),this.observer?.disconnect(),this.observer=void 0,this.root.remove(),this.options.autoFocus!==!1&&this.previousFocus instanceof HTMLElement&&this.previousFocus.focus({preventScroll:!0}),this.previousFocus=null;let t=this.resolve;this.resolve=void 0,t?.(e)};setSize(e){this.manualSize=e,this.reposition()}destroy(){this.close(),this.root.remove()}reposition=()=>{if(!this.open)return;let e=this.doc.defaultView,t=e?.innerWidth??0,n=e?.innerHeight??0,r=this.anchorRect(),[i,a]=this.offset,[o,s]=this.split(this.placement),c={bottom:n-r.bottom-a-Y,top:r.top-a-Y,right:t-r.right-a-Y,left:r.left-a-Y};this.root.style.position=`fixed`,this.root.style.maxHeight=``,this.manualSize?(this.root.style.width=`${this.manualSize.width}px`,this.root.style.height=`${this.manualSize.height}px`):this.options.matchAnchorWidth&&r.width&&(this.root.style.width=`${r.width}px`);let l=this.root.getBoundingClientRect(),u=o===`top`||o===`bottom`?l.height:l.width,d=o,f={bottom:`top`,top:`bottom`,right:`left`,left:`right`};u>c[o]&&c[f[o]]>c[o]&&(d=f[o]),(d===`top`||d===`bottom`)&&(this.root.style.maxHeight=`${Math.max(er,c[d])}px`,l=this.root.getBoundingClientRect());let p,m;d===`bottom`||d===`top`?(m=d===`bottom`?r.bottom+a:r.top-l.height-a,p=s===`end`?r.right-l.width+i:s===`center`?r.left+(r.width-l.width)/2+i:r.left+i):(p=d===`right`?r.right+a:r.left-l.width-a,m=s===`end`?r.bottom-l.height+i:s===`center`?r.top+(r.height-l.height)/2+i:r.top+i),p=Math.max(Y,Math.min(p,t-l.width-Y)),m=Math.max(Y,Math.min(m,n-l.height-Y)),this.root.style.left=`${Math.round(p)}px`,this.root.style.top=`${Math.round(m)}px`,this.resolvedPlacement=s?`${d}-${s}`:d,this.root.setAttribute(`data-placement`,this.resolvedPlacement)};anchorRect(){let e=this.options.anchor;if(e instanceof Element)return e.getBoundingClientRect();let{x:t,y:n}=e;return{top:n,left:t,bottom:n,right:t,width:0,height:0}}split(e){let[t,n=`center`]=e.split(`-`);return[t,n]}onDocumentPointerDown=e=>{let t=e.target;!t||this.root.contains(t)||this.options.anchor instanceof Element&&this.options.anchor.contains(t)||this.options.ignoreOutside&&t.closest?.(this.options.ignoreOutside)||this.close()};onDocumentKeyDown=e=>{e.key===`Escape`&&(e.preventDefault(),e.stopPropagation(),this.close())};onResizePointerDown=e=>{if(e.pointerType===`mouse`&&e.button!==0)return;e.preventDefault(),e.stopPropagation();let t=e.currentTarget,n=this.root.getBoundingClientRect(),r=e.clientX,i=e.clientY,a=this.resolvedPlacement.startsWith(`top`),o=this.options.minWidth??n.width,s=this.options.minHeight??n.height,c=e=>{let t=a?i-e.clientY:e.clientY-i;this.manualSize={width:Math.max(o,n.width+(e.clientX-r)),height:Math.max(s,n.height+t)},this.reposition(),this.options.onResize?.(this.manualSize)},l=()=>{t.removeEventListener(`pointermove`,c),t.removeEventListener(`pointerup`,l),t.removeEventListener(`lostpointercapture`,l)};t.setPointerCapture(e.pointerId),t.addEventListener(`pointermove`,c),t.addEventListener(`pointerup`,l),t.addEventListener(`lostpointercapture`,l)}},nr=24,rr=4,ir=`<span class="avg-list-box avg-checked">${Qe}</span>`,ar=`<span class="avg-list-box">${$e}</span>`,or=`<span class="avg-list-box avg-checked">${ct}</span>`,sr=class{element;options;body;searchInput;selectAllRow;emptyEl;render;items=[];filtered=[];selectedSet=new Set;selectedOrder=[];searchText=``;_activeIndex=-1;constructor(e){this.options=e;let t=e.multiple!==!1;this.element=document.createElement(`div`),this.element.className=`avg-list${e.className?` ${e.className}`:``}`,this.element.setAttribute(`data-type`,`list`),t&&this.element.setAttribute(`data-multiple`,``),e.search!==!1&&(this.searchInput=document.createElement(`input`),this.searchInput.className=`avg-list-search`,this.searchInput.type=`text`,this.searchInput.placeholder=e.searchPlaceholder??`search…`,this.element.appendChild(this.searchInput)),(e.selectAll??t)&&(this.selectAllRow=document.createElement(`div`),this.selectAllRow.className=`avg-list-item avg-list-all`,this.selectAllRow.setAttribute(`data-list-action`,`all`),this.selectAllRow.innerHTML=`${ar}<span class="avg-list-label"></span>`,Ae(this.selectAllRow.lastElementChild,e.selectAllLabel??`select all`),this.element.appendChild(this.selectAllRow)),this.body=document.createElement(`div`),this.body.className=`avg-list-body`,this.element.appendChild(this.body),this.emptyEl=document.createElement(`div`),this.emptyEl.className=`avg-list-empty`,Ae(this.emptyEl,e.emptyLabel??`no matches`),this.emptyEl.style.display=`none`,this.element.appendChild(this.emptyEl),this.items=e.items??[],this.filtered=this.items,this._activeIndex=this.filtered.length?0:-1;for(let t of e.selected??[])this.selectedSet.has(t)||(this.selectedSet.add(t),this.selectedOrder.push(t));this.render=new Fn(this.body,{name:`avg-list`,className:`avg-list-grid`,rowCount:()=>this.filtered.length,columnCount:1,rowHeight:e.rowHeight??nr,overscanRow:e.overscanRow??rr,columnWidth:()=>`100%`,fitToWidth:!0,renderCell:this.renderCell,height:`100%`}),this.element.addEventListener(`click`,this.onClick),this.element.addEventListener(`keydown`,this.onKeyDown),this.searchInput?.addEventListener(`input`,this.onSearchInput),this.emptyEl.style.display=this.filtered.length?`none`:``,this.syncSelectAll()}getSelected(){return[...this.selectedOrder]}getSelectedItems(){let e=new Map(this.items.map(e=>[e.value,e]));return this.selectedOrder.map(t=>e.get(t)??{value:t})}setSelected(e,t=!1){this.selectedSet.clear(),this.selectedOrder=[];for(let t of e)this.selectedSet.has(t)||(this.selectedSet.add(t),this.selectedOrder.push(t));this.syncSelectAll(),this.render.model.update({all:!0}),t&&this.emitChange()}setItems(e){this.items=e,this.applyFilter()}getItems(){return this.items}getVisibleItems(){return this.filtered}get search(){return this.searchText}get activeIndex(){return this._activeIndex}getActiveItem(){return this.filtered[this._activeIndex]}setActiveIndex(e){this.setActive(Math.max(-1,Math.min(e,this.filtered.length-1)))}setSearch(e){this.searchText=e,this.searchInput&&this.searchInput.value!==e&&(this.searchInput.value=e),this.applyFilter()}focus(){this.searchInput?this.searchInput.focus():this.render.model.gridRef.current?.focus({preventScroll:!0})}scrollToIndex(e,t=`nearest`){this.render.model.scrollToRow(e,t)}measure(){this.render.model.checkSize()}destroy(){this.element.removeEventListener(`click`,this.onClick),this.element.removeEventListener(`keydown`,this.onKeyDown),this.searchInput?.removeEventListener(`input`,this.onSearchInput),this.render.destroy(),this.element.remove()}renderCell=e=>{let t=e.previous??e.recycle?.()??document.createElement(`div`),n=this.filtered[e.row];t.childElementCount!==2&&(t.textContent=``,t.insertAdjacentHTML(`afterbegin`,`${ar}<span class="avg-list-label"></span>`));let r=t.firstElementChild,i=t.lastElementChild;t.className=`avg-list-item`,t.setAttribute(`data-index`,String(e.row));let a=!!n&&this.selectedSet.has(n.value),o=a?`1`:`0`;return r.getAttribute(`data-checked`)!==o&&(r.innerHTML=a?ir:ar,r.setAttribute(`data-checked`,o)),a?t.setAttribute(`data-selected`,``):t.removeAttribute(`data-selected`),e.row===this._activeIndex?t.setAttribute(`data-active`,``):t.removeAttribute(`data-active`),n?.disabled?t.setAttribute(`data-disabled`,``):t.removeAttribute(`data-disabled`),Ae(i,n?n.label??String(n.value):``),F(t,e.style),t};applyFilter(){let e=this.searchText.trim().toLowerCase();this.filtered=!e||this.options.onSearch?this.items:this.items.filter(t=>(t.label??String(t.value)).toLowerCase().includes(e)),this._activeIndex=this.filtered.length?0:-1,this.emptyEl.style.display=this.filtered.length?`none`:``,this.syncSelectAll(),this.render.model.update({all:!0}),this.render.model.scrollToRow(0,`top`)}syncSelectAll(){if(!this.selectAllRow)return;let e=0;for(let t of this.filtered)this.selectedSet.has(t.value)&&e++;let t=this.filtered.length&&e===this.filtered.length?`all`:e?`some`:`none`,n=this.selectAllRow.firstElementChild;n.getAttribute(`data-checked`)!==t&&(n.innerHTML=t===`all`?ir:t===`some`?or:ar,n.setAttribute(`data-checked`,t),this.selectAllRow.setAttribute(`data-state`,t))}onSearchInput=()=>{this.searchText=this.searchInput?.value??``,this.options.onSearch&&this.options.onSearch(this.searchText),this.applyFilter()};onClick=e=>{let t=e.target;if(!t)return;if(t.closest(`[data-list-action="all"]`)){this.toggleAll();return}let n=t.closest(`[data-index]`);if(!n)return;let r=Number(n.getAttribute(`data-index`)),i=this.filtered[r];!i||i.disabled||(this.setActive(r),this.options.multiple===!1?(this.setSelected([i.value]),this.emitChange(),this.options.onActivate?.(i)):this.toggle(i))};onKeyDown=e=>{let t=this.filtered.length,n=Math.max(1,this.render.model.visibleRowCount),r=n=>{e.preventDefault(),this.setActive(Math.max(0,Math.min(t-1,n))),this._activeIndex>=0&&this.scrollToIndex(this._activeIndex)};switch(e.key){case`ArrowDown`:t&&r(this._activeIndex+1);break;case`ArrowUp`:t&&r(this._activeIndex-1);break;case`Home`:t&&r(0);break;case`End`:t&&r(t-1);break;case`PageDown`:t&&r(this._activeIndex+n);break;case`PageUp`:t&&r(this._activeIndex-n);break;case` `:case`Enter`:{let t=this.filtered[this._activeIndex];if(!t||t.disabled||e.key===` `&&e.target===this.searchInput)return;e.preventDefault(),this.options.multiple===!1?(this.setSelected([t.value]),this.emitChange()):this.toggle(t),e.key===`Enter`&&this.options.onActivate?.(t);break}}};setActive(e){if(e===this._activeIndex)return;let t=this._activeIndex;this._activeIndex=e;let n=[t,e].filter(e=>e>=0);n.length&&this.render.model.update({rows:n})}toggle(e){this.selectedSet.has(e.value)?(this.selectedSet.delete(e.value),this.selectedOrder=this.selectedOrder.filter(t=>t!==e.value)):(this.selectedSet.add(e.value),this.selectedOrder.push(e.value));let t=this.filtered.indexOf(e);t>=0&&this.render.model.update({rows:[t]}),this.syncSelectAll(),this.emitChange()}toggleAll(){let e=this.filtered.filter(e=>!e.disabled);if(e.length>0&&e.every(e=>this.selectedSet.has(e.value))){for(let t of e)this.selectedSet.delete(t.value);let t=new Set(e.map(e=>e.value));this.selectedOrder=this.selectedOrder.filter(e=>!t.has(e))}else for(let t of e)this.selectedSet.has(t.value)||(this.selectedSet.add(t.value),this.selectedOrder.push(t.value));this.syncSelectAll(),this.render.model.update({all:!0}),this.emitChange()}emitChange(){this.options.onChange?.(this.getSelected(),this.getSelectedItems())}};function X(e,t,n){let r=document.createElement(`button`);return r.type=`button`,r.className=`avg-button${n?.primary?` avg-button-primary`:``}`,r.setAttribute(`data-action`,t),r.textContent=e,n?.title&&(r.title=n.title),r}function cr(e,t,n){let r=document.createElement(`button`);return r.type=`button`,r.className=`avg-icon-button${n?.className?` ${n.className}`:``}`,r.setAttribute(`data-action`,t),r.innerHTML=e,n?.title&&(r.title=n.title),r}var lr=260,ur=`(empty)`,dr=104,fr=24,pr=180,mr=380;function Z(e){return e instanceof Date?`date:${e.getTime()}`:e===null?`null`:e===void 0?`undefined`:`${typeof e}:${String(e)}`}function hr(e){let t=e.label??String(e.value??``);return t.length?t:ur}var gr=class{element;options;list;applyButton;offered=[];selected;request=0;constructor(e){this.options=e,this.selected=Array.isArray(e.filter.value)?[...e.filter.value]:[],this.element=document.createElement(`div`),this.element.className=`avg-filter-content`,this.element.style.minWidth=`${Math.max(e.width??0,260)}px`,this.list=new sr({className:`avg-filter-list`,emptyLabel:`no values`,searchPlaceholder:`search values…`,onChange:()=>this.onSelectionChange()}),this.list.element.addEventListener(`input`,this.onSearchInput),this.element.appendChild(this.list.element);let t=document.createElement(`div`);t.className=`avg-filter-buttons`,this.applyButton=X(`Apply`,`apply`,{primary:!0}),t.append(this.applyButton,X(`Clear`,`clear`)),this.element.appendChild(t),this.element.addEventListener(`click`,this.onClick),this.load(void 0)}focus(){this.list.focus()}measure(){this.list.measure()}destroy(){this.element.removeEventListener(`click`,this.onClick),this.list.element.removeEventListener(`input`,this.onSearchInput),this.list.destroy(),this.element.remove()}load(e){let t=++this.request,n=this.options.model.models.filters.getOptions(this.options.filter.columnKey,e);if(Array.isArray(n)){this.setOptions(n);return}this.list.setItems([]),Promise.resolve(n).then(e=>{t===this.request&&this.setOptions(e)},e=>{t===this.request&&(console.warn(`av-grid: onGetOptions failed:`,e),this.setOptions([]))})}setOptions(e){let t=new Set((Array.isArray(this.options.filter.value)?this.options.filter.value:[]).map(e=>Z(e?.value))),n=[],r=[];for(let i of e)(t.has(Z(i?.value))?n:r).push(i);this.offered=[...n,...r];let i=this.offered.map((e,t)=>({value:t,label:hr(e)}));this.list.setItems(i);let a=new Map(this.offered.map((e,t)=>[Z(e?.value),t])),o=[];for(let e of this.selected){let t=a.get(Z(e?.value));t!==void 0&&o.push(t)}this.list.setSelected(o),this.syncApply(),this.options.onPreferredHeight?.(Math.min(mr,Math.max(pr,dr+this.offered.length*fr)))}onSearchInput=()=>{this.load(this.list.search||void 0)};onSelectionChange(){let e=new Set(this.offered.map(e=>Z(e?.value))),t=this.selected.filter(t=>!e.has(Z(t?.value))),n=this.list.getSelected().map(e=>this.offered[e]).filter(Boolean);this.selected=[...t,...n],this.syncApply()}syncApply(){this.applyButton.disabled=!this.selected.length}onClick=e=>{let t=e.target?.closest?.(`[data-action]`);if(!(!t||!this.element.contains(t)))switch(t.getAttribute(`data-action`)){case`apply`:this.apply();break;case`clear`:this.options.onApply({...this.options.filter,value:void 0})}};apply(){let e=new Set,t=[];for(let n of this.selected){let r=Z(n?.value);e.has(r)||(e.add(r),t.push(n))}this.options.onApply({...this.options.filter,value:t.length?t:void 0})}},_r=class{element;options;body;constructor(e){if(this.options=e,this.element=document.createElement(`div`),this.element.className=`avg-filter-content avg-custom-filter-content`,this.body=e.definition.create({column:e.column,value:e.filter.value,filter:e.filter,apply:e=>this.applyValue(e),close:()=>e.onClose()}),!this.body||!(this.body.element instanceof HTMLElement))throw Error(`av-grid: the "${e.definition.name}" filter on column "${String(e.column.key)}" returned no element from \`create()\`. Return { element, getValue }.`);if(typeof this.body.getValue!=`function`)throw Error(`av-grid: the "${e.definition.name}" filter on column "${String(e.column.key)}" returned no \`getValue\` from \`create()\`. It is what Apply reads.`);let t=document.createElement(`div`);t.className=`avg-custom-filter-body`,t.appendChild(this.body.element);let n=document.createElement(`div`);n.className=`avg-filter-buttons`,n.append(X(`Apply`,`apply`,{primary:!0}),X(`Clear`,`clear`)),this.element.append(t,n),this.element.addEventListener(`click`,this.onClick)}focus(){if(this.body.focus){this.body.focus();return}(this.body.element.querySelector(`input, select, textarea, button, [tabindex]`)??this.body.element).focus?.()}measure(){}destroy(){this.element.removeEventListener(`click`,this.onClick),this.body.destroy?.(),this.element.remove()}onClick=e=>{let t=e.target?.closest?.(`[data-action]`);if(!(!t||!this.element.contains(t))&&!this.body.element.contains(t))switch(t.getAttribute(`data-action`)){case`apply`:this.applyValue(this.body.getValue());break;case`clear`:this.applyValue(void 0)}};applyValue(e){this.options.onApply({...this.options.filter,value:e})}};function vr(e,t){let n=(e.renderModel?.gridRef.current)?.querySelectorAll(`[data-type="header-cell"]`);if(n){for(let e of Array.from(n))if(e.getAttribute(`data-column-key`)===t)return e.querySelector(`[data-type="filter-button"]`)??e}}function yr(e,t,n={}){let r=e.models.filters,i=e.data.columns.find(e=>String(e.key)===t);if(!i)return console.warn(`av-grid: showFilterPopover("${t}") — no such column. Available: ${e.data.columns.map(e=>String(e.key)).join(`, `)}.`),Promise.resolve(void 0);let a=r.filterOrDefault(t),o=i.filter,s=o?o.name:i.filterType??a.type??`options`;if(!o&&s!==`options`)return console.warn(`av-grid: no filter body for filterType "${s}" on column "${t}". A filter type of your own is a \`filter\` definition on the column.`),Promise.resolve(void 0);e.flags.filterPopover?.close();let c=n.anchor??vr(e,t);if(!c)return console.warn(`av-grid: showFilterPopover("${t}") — the column is not rendered, so there is nothing to anchor to. Pass an anchor element or a point.`),Promise.resolve(void 0);let l=c instanceof Element?c.clientWidth:0,u=Math.max(l,260),d=!!n.size,f=new tr({anchor:c,className:`avg-filter-popover`,placement:`bottom-start`,offset:n.offset,resizable:!o,size:n.size,minWidth:o?void 0:260,minHeight:o?void 0:160,onResize:e=>{d=!0,n.onResize?.(e)}}),p=e=>{r.applyFilter(e),f.close(r.filterFor(e.columnKey))},m;if(o)try{m=new _r({column:i,definition:o,filter:a,onApply:p,onClose:()=>f.close(void 0)})}catch(e){return console.warn(`av-grid: the "${o.name}" filter on column "${t}" failed to build its body:`,e),f.destroy(),Promise.resolve(void 0)}else{let t;t=new gr({model:e,filter:a,onApply:p,width:u,onPreferredHeight:e=>{d||(f.setSize({width:u,height:e}),t?.measure())}}),m=t}f.content.appendChild(m.element),e.flags.filterPopover={columnKey:t,close:f.close},e.update({rows:[0]});let h=f.show().then(t=>(m.destroy(),e.flags.filterPopover?.close===f.close&&(e.flags.filterPopover=void 0,e.update({rows:[0]})),t));return m.measure(),m.focus(),h}var br=20,xr=400,Sr=26;function Cr(e){return new wr(e).show()}var wr=class e{options;doc;popover;list;search;prepared=[];activeId;submenu;submenuTimer;submenuOf;constructor(e){this.options=e,this.doc=e.document??(e.anchor instanceof Element?e.anchor.ownerDocument:document),this.popover=new tr({anchor:e.anchor,placement:e.placement??`bottom-start`,offset:e.offset??[0,2],className:`avg-menu${e.className?` ${e.className}`:``}`,ignoreOutside:`.avg-menu`,document:this.doc}),e.items.filter(e=>!e.invisible).length>20&&(this.search=this.doc.createElement(`input`),this.search.className=`avg-list-search avg-menu-search`,this.search.type=`text`,this.search.placeholder=`Search...`,this.search.addEventListener(`input`,this.onSearchInput),this.popover.content.appendChild(this.search)),this.list=this.doc.createElement(`div`),this.list.className=`avg-menu-list`,this.popover.content.appendChild(this.list),this.popover.root.addEventListener(`keydown`,this.onKeyDown),this.build()}get isOpen(){return this.popover.isOpen}show(){let e=this.popover.show().then(e=>(this.teardown(),e));return this.search?.focus({preventScroll:!0}),e}close=e=>{this.popover.close(e)};build(){this.closeSubmenu(),this.list.textContent=``,this.prepared=[];let e=this.search?.value.trim().toLocaleLowerCase()??``,t=this.options.items.some(e=>!e.invisible&&!!e.icon),n=!1;if(this.options.items.forEach((r,i)=>{if(!(!r.invisible&&(!e||r.label.toLocaleLowerCase().includes(e)))){r.startGroup&&(n=!0);return}let a=r.id??`${i}:${r.label}`,o=this.row(r,t);o.setAttribute(`data-id`,a),(r.startGroup||n)&&this.prepared.length>0&&o.setAttribute(`data-start-group`,``),n=!1,this.list.appendChild(o),this.prepared.push({item:r,id:a,el:o})}),!this.prepared.length){let e=this.doc.createElement(`div`);e.className=`avg-list-empty`,e.textContent=`No matches`,this.list.appendChild(e)}let r=this.prepared.find(e=>e.item.selected);this.setActive(r?.id??void 0)}row(e,t){let n=this.doc.createElement(`div`);if(n.className=`avg-menu-item`,n.setAttribute(`data-type`,`menu-item`),e.disabled&&n.setAttribute(`data-disabled`,``),e.minor&&n.setAttribute(`data-minor`,``),t){let t=this.doc.createElement(`span`);t.className=`avg-menu-icon`,typeof e.icon==`string`?t.innerHTML=e.icon:e.icon&&t.appendChild(e.icon),n.appendChild(t)}let r=this.doc.createElement(`span`);if(r.className=`avg-menu-label`,r.textContent=e.label,n.appendChild(r),e.hotKey){let t=this.doc.createElement(`span`);t.className=`avg-menu-hotkey`,t.textContent=e.hotKey,n.appendChild(t)}if(e.items?.length){let e=this.doc.createElement(`span`);e.className=`avg-menu-chevron`,e.innerHTML=it,n.appendChild(e)}else if(e.selected){let e=this.doc.createElement(`span`);e.className=`avg-menu-check`,e.innerHTML=Ze,n.appendChild(e)}return n.addEventListener(`mouseenter`,()=>this.onRowEnter(e,n)),n.addEventListener(`mouseleave`,this.clearSubmenuTimer),n.addEventListener(`click`,()=>this.activate(e,n)),n}activate(e,t){if(!e.disabled){if(e.items?.length){this.openSubmenu(e,t);return}e.onClick?.(),this.close(e)}}onRowEnter(e,t){e.disabled||(this.setActive(t.getAttribute(`data-id`)??void 0),this.clearSubmenuTimer(),this.submenu&&this.submenu.item!==e&&this.closeSubmenu(),!(!e.items?.length||this.submenu?.item===e)&&(this.submenuTimer=this.doc.defaultView?.setTimeout(()=>{this.submenuTimer=void 0,this.openSubmenu(e,t)},400)))}openSubmenu(t,n){if(this.clearSubmenuTimer(),this.submenu?.item===t)return;this.closeSubmenu();let r=new e({anchor:n,items:t.items??[],placement:`right-start`,offset:[-4,0],document:this.doc});r.submenuOf=this,this.submenu={item:t,menu:r},n.setAttribute(`data-submenu-open`,``),r.show().then(e=>{n.removeAttribute(`data-submenu-open`),this.submenu?.menu===r&&(this.submenu=void 0),e&&this.close(e)})}closeSubmenu(){this.clearSubmenuTimer();let e=this.submenu;this.submenu=void 0,e?.menu.close()}clearSubmenuTimer=()=>{this.submenuTimer!==void 0&&(this.doc.defaultView?.clearTimeout(this.submenuTimer),this.submenuTimer=void 0)};setActive(e){if(this.activeId!==e){for(let t of this.prepared)t.id===this.activeId&&t.el.removeAttribute(`data-active`),t.id===e&&t.el.setAttribute(`data-active`,``);this.activeId=e,e!==void 0&&this.prepared.find(t=>t.id===e)?.el.scrollIntoView?.({block:`nearest`})}}move(e){if(!this.prepared.length)return;let t=this.prepared.findIndex(e=>e.id===this.activeId),n=Math.max(0,Math.min(this.prepared.length-1,(t<0?-1:t)+e));this.setActive(this.prepared[n].id)}onKeyDown=e=>{if(this.submenu)return;let t=Math.max(1,Math.floor((this.list.clientHeight||208)/Sr)),n=this.prepared.find(e=>e.id===this.activeId);switch(e.key){case`ArrowDown`:e.preventDefault(),this.move(1);return;case`ArrowUp`:e.preventDefault(),this.move(-1);return;case`PageDown`:e.preventDefault(),this.move(t);return;case`PageUp`:e.preventDefault(),this.move(-t);return;case`Home`:if(this.search)return;e.preventDefault(),this.setActive(this.prepared[0]?.id);return;case`End`:if(this.search)return;e.preventDefault(),this.setActive(this.prepared[this.prepared.length-1]?.id);return;case`ArrowRight`:if(!n?.item.items?.length)return;e.preventDefault(),this.openSubmenu(n.item,n.el);return;case`ArrowLeft`:if(!this.submenuOf)return;e.preventDefault(),this.close();return;case`Enter`:{let t=n??(this.prepared.length===1?this.prepared[0]:void 0);if(!t)return;e.preventDefault(),this.activate(t.item,t.el);return}default:return}};onSearchInput=()=>{this.build(),this.popover.reposition()};teardown(){this.closeSubmenu(),this.popover.root.removeEventListener(`keydown`,this.onKeyDown),this.search?.removeEventListener(`input`,this.onSearchInput),this.list.textContent=``,this.prepared=[]}};function Q(e,t){return`${e} ${t}${e===1?``:`s`}`}function Tr(e,t){let n=e.options,{copyPaste:r,structure:i}=e.models,{rows:a,columns:o}=t.selectedCount,s=n.rowNoun??`row`,c=[],l=n.getContextMenuItems?.(t)??[];if(c.push(...l),t.target===`header`&&t.column){let e=String(t.column.key);return c.push({id:`avg-insert-column`,label:`Insert column`,icon:B,startGroup:l.length>0,invisible:!i.canAddColumns||T(t.column),onClick:()=>{let t=n.columns.findIndex(t=>String(t.key)===e);i.addBlankColumns(1,t<0?void 0:t)}},{id:`avg-delete-column`,label:`Delete column`,icon:st,invisible:!i.canDeleteColumns||T(t.column),onClick:()=>i.deleteColumns([e])}),c.filter(e=>!e.invisible)}return t.target!==`cell`||a===0||c.push({id:`avg-copy`,label:`Copy`,icon:at,hotKey:`(Ctrl+C)`,startGroup:l.length>0,invisible:!r.enabled,onClick:()=>void r.copySelection()},{id:`avg-copy-as`,label:`Copy as...`,icon:at,invisible:!r.enabled,items:[{id:`avg-copy-as-headers`,label:`With Headers`,hotKey:`(Ctrl+Shift+C)`,onClick:()=>void r.copySelection(`copyWithHeaders`)},{id:`avg-copy-as-json`,label:`JSON`,onClick:()=>void r.copySelection(`copyAsJson`)},{id:`avg-copy-as-html`,label:`Formatted (HTML Table)`,onClick:()=>void r.copySelection(`copyAsHtmlTable`)}]},{id:`avg-paste`,label:`Paste`,icon:ot,hotKey:`(Ctrl+V)`,invisible:!r.enabled||!n.editable,onClick:()=>void r.paste()},{id:`avg-insert-rows`,label:`Insert ${Q(a,s)}`,icon:B,hotKey:`(Ctrl+Insert)`,startGroup:!0,invisible:!i.canAddRows,onClick:()=>i.insertRowsAtSelection()},{id:`avg-add-rows`,label:`Add ${Q(a,s)}`,icon:B,hotKey:a===1?`(Last Row ↓)`:void 0,invisible:!i.canAddRows,onClick:()=>i.addBlankRows(a)},{id:`avg-delete-rows`,label:`Delete ${Q(a,s)}`,icon:st,hotKey:`(Ctrl+Delete)`,invisible:!i.canDeleteRows,onClick:()=>i.deleteSelectedRows()},{id:`avg-insert-columns`,label:`Insert ${Q(o,`column`)}`,icon:B,hotKey:`(Ctrl+Shift+Insert)`,startGroup:!0,minor:!0,invisible:!i.canAddColumns,onClick:()=>i.insertColumnsAtSelection()},{id:`avg-add-columns`,label:`Add ${Q(o,`column`)}`,icon:B,minor:!0,invisible:!i.canAddColumns,onClick:()=>i.addBlankColumns(o)},{id:`avg-delete-columns`,label:`Delete ${Q(o,`column`)}`,icon:st,hotKey:`(Ctrl+Shift+Delete)`,minor:!0,invisible:!i.canDeleteColumns,onClick:()=>i.deleteSelectedColumns()}),c.filter(e=>!e.invisible)}function Er(e,t,n){let r=e.models.focus,i,a=!1,o={x:t.clientX,y:t.clientY,target:n.target,selectedCount:r.selectedCount,event:t,get selection(){return a||(a=!0,i=r.getGridSelection()),i}};if(n.target===`header`)return{...o,column:e.data.columns[n.colIndex]};if(n.target===`cell`){let t=e.cellContext(n.rowIndex,n.colIndex);return{...o,column:t?.column,row:t?.row,rowKey:t?.rowKey,rowIndex:n.rowIndex,colIndex:n.colIndex}}return o}function Dr(e,t){let n=Tr(e,t),r=e.options.onGridContextMenu;if(r)return r(t,n),!0;if(!n.length)return!1;e.flags.contextMenu?.close();let i=new wr({anchor:{x:t.x,y:t.y},items:n});return e.flags.contextMenu={close:i.close},i.show().then(()=>{e.flags.contextMenu?.close===i.close&&(e.flags.contextMenu=void 0)}),!0}var Or=11,kr=`application/x-av-grid-column`,Ar=16,jr=2,Mr=48;function Nr(e){if(e===0)return 0;let t=Math.min(Mr,Math.max(jr,Math.abs(e)*.5));return e<0?-t:t}var Pr=class{model;grid;root;resizing=!1;suppressClick=!1;resizeState;selecting=!1;lastSelectRow=-1;lastSelectCol=-1;pointerX=0;pointerY=0;autoScrollRaf;hasPointer=!1;hoverRaf;constructor(e,t){this.model=e,this.grid=t,this.root=t.root,this.root.tabIndex=0,this.root.addEventListener(`keydown`,this.onKeyDown),this.root.addEventListener(`pointerdown`,this.onPointerDown),this.root.addEventListener(`click`,this.onClick),this.root.addEventListener(`dblclick`,this.onDoubleClick),this.root.addEventListener(`contextmenu`,this.onContextMenu),this.root.addEventListener(`pointermove`,this.onPointerMove),this.root.addEventListener(`pointerleave`,this.onPointerLeave),this.grid.container.addEventListener(`scroll`,this.onScrolled,{passive:!0}),this.root.addEventListener(`dragstart`,this.onDragStart),this.root.addEventListener(`dragover`,this.onDragOver),this.root.addEventListener(`drop`,this.onDrop),this.root.addEventListener(`dragend`,this.onDragEnd),this.root.addEventListener(`copy`,this.onCopy),this.root.addEventListener(`cut`,this.onCut),this.root.addEventListener(`paste`,this.onPaste)}destroy(){this.root.removeEventListener(`keydown`,this.onKeyDown),this.root.removeEventListener(`pointerdown`,this.onPointerDown),this.root.removeEventListener(`click`,this.onClick),this.root.removeEventListener(`dblclick`,this.onDoubleClick),this.root.removeEventListener(`contextmenu`,this.onContextMenu),this.root.removeEventListener(`pointermove`,this.onPointerMove),this.root.removeEventListener(`pointerleave`,this.onPointerLeave),this.grid.container.removeEventListener(`scroll`,this.onScrolled),this.root.removeEventListener(`dragstart`,this.onDragStart),this.root.removeEventListener(`dragover`,this.onDragOver),this.root.removeEventListener(`drop`,this.onDrop),this.root.removeEventListener(`dragend`,this.onDragEnd),this.root.removeEventListener(`copy`,this.onCopy),this.root.removeEventListener(`cut`,this.onCut),this.root.removeEventListener(`paste`,this.onPaste),this.endResize(),this.endSelect(),this.hoverRaf!==void 0&&(cancelAnimationFrame(this.hoverRaf),this.hoverRaf=void 0)}headerAt(e){let t=e?.closest?.(`[data-type="header-cell"]`);if(!(!t||!this.root.contains(t)))return{el:t,row:0,col:Number(t.getAttribute(`data-col`))}}dataCellAt(e){let t=e?.closest?.(`[data-type="data-cell"]`);if(!(!t||!this.root.contains(t)))return{el:t,row:Number(t.getAttribute(`data-row`)),col:Number(t.getAttribute(`data-col`))}}focusRoot(e){e?.closest?.(`input, textarea, select, button, a, [contenteditable='true']`)||this.root.focus({preventScroll:!0})}onPointerDown=e=>{this.focusRoot(e.target);let t=this.headerAt(e.target);if(!t){this.onCellPointerDown(e);return}if(e.pointerType===`mouse`&&e.buttons!==1||t.el.getAttribute(`data-resizable`)!==`true`)return;let n=t.el.getBoundingClientRect(),r=t.el.getAttribute(`data-pinned`)===`right`,i=r?e.clientX-n.left:n.right-e.clientX;i>Or||(e.stopPropagation(),e.preventDefault(),this.resizing=!0,this.suppressClick=!0,this.resizeState={columnKey:t.el.getAttribute(`data-column-key`)??``,pointerId:e.pointerId,offset:i,left:n.left,fromLeftEdge:r?{startX:e.clientX,startWidth:n.width}:void 0},this.root.setPointerCapture(e.pointerId),this.root.addEventListener(`pointermove`,this.onResizeMove),this.root.addEventListener(`pointerup`,this.endResize),this.root.addEventListener(`lostpointercapture`,this.endResize))};onResizeMove=e=>{let t=this.resizeState;if(!t)return;e.preventDefault();let n=t.fromLeftEdge?Math.round(t.fromLeftEdge.startWidth+t.fromLeftEdge.startX-e.clientX):Math.round(e.clientX+t.offset-t.left);n>0&&this.model.events.onColumnResize.send({columnKey:t.columnKey,width:n})};endResize=()=>{if(!this.resizeState)return;let{pointerId:e}=this.resizeState;this.resizeState=void 0,this.resizing=!1,this.root.removeEventListener(`pointermove`,this.onResizeMove),this.root.removeEventListener(`pointerup`,this.endResize),this.root.removeEventListener(`lostpointercapture`,this.endResize),this.root.hasPointerCapture?.(e)&&this.root.releasePointerCapture(e)};onCellPointerDown=e=>{let t=this.dataCellAt(e.target);if(!t)return;let n=this.model.cellContext(t.row,t.col);if(!n||T(n.column))return;let r=this.model.models.focus.focus,i=!!(r&&r.rowKey===n.rowKey&&String(r.columnKey)===String(n.column.key));if(this.model.events.cell.onMouseDown.send({e,row:n.row,col:n.column,rowIndex:t.row,colIndex:t.col,wasFocused:i}),e.button!==0)return;e.preventDefault();let a=e.target?.closest?.(`[data-type="bool-toggle"]`);if(a&&this.root.contains(a)){this.model.models.editing.toggleBooleanCell(t.row,t.col),this.endDragThatNeverStarted();return}if(this.model.models.editing.isEditingCell(t.row,t.col)){this.endDragThatNeverStarted();return}this.selecting=!0,this.lastSelectRow=t.row,this.lastSelectCol=t.col,this.pointerX=e.clientX,this.pointerY=e.clientY,window.addEventListener(`pointermove`,this.onSelectMove),window.addEventListener(`pointerup`,this.endSelect),window.addEventListener(`pointercancel`,this.endSelect)};onSelectMove=e=>{this.pointerX=e.clientX,this.pointerY=e.clientY,this.extendSelection(),this.updateAutoScroll()};endDragThatNeverStarted(){this.model.models.focus.isDragging&&this.model.events.cell.onSelectEnd.send()}endSelect=()=>{this.selecting&&(this.selecting=!1,this.lastSelectRow=-1,this.lastSelectCol=-1,this.stopAutoScroll(),window.removeEventListener(`pointermove`,this.onSelectMove),window.removeEventListener(`pointerup`,this.endSelect),window.removeEventListener(`pointercancel`,this.endSelect),this.model.events.cell.onSelectEnd.send())};extendSelection(){let e=this.selectionTarget();if(!e||e.row===this.lastSelectRow&&e.col===this.lastSelectCol)return;this.lastSelectRow=e.row,this.lastSelectCol=e.col;let t=this.model.cellContext(e.row,e.col);t&&this.model.events.cell.onSelectMove.send({row:t.row,col:t.column,rowIndex:e.row,colIndex:e.col})}selectionTarget(){let e=this.dataCellAt(this.root.ownerDocument.elementFromPoint(this.pointerX,this.pointerY));if(e)return{row:e.row,col:e.col};let{x:t,y:n}=this.edgeOverflow(),{visible:r}=this.grid.model.renderInfo.current,i=this.lastSelectRow,a=this.lastSelectCol;if(n>0?i=this.model.gridRowToDataRow(r.bottom):n<0&&(i=this.model.gridRowToDataRow(r.top)),t>0?a=r.right:t<0&&(a=r.left),i=Math.max(0,i),a=Math.max(0,a),!(i>=this.model.data.rows.length||a>=this.model.data.columns.length))return{row:i,col:a}}dataAreaRect(){let e=this.grid.container.getBoundingClientRect(),{innerSize:t}=this.grid.model.renderInfo.current;return{left:e.left+t.stickyLeftWidth,top:e.top+t.stickyTopHeight,right:e.right-t.stickyRightWidth-this.grid.model.scrollBarWidth,bottom:e.bottom-t.stickyBottomHeight-this.grid.model.scrollBarHeight}}edgeOverflow(){let e=this.dataAreaRect(),t=(e,t,n)=>{let r=t+Ar,i=n-Ar;return e<r?e-r:e>i?e-i:0};return{x:t(this.pointerX,e.left,e.right),y:t(this.pointerY,e.top,e.bottom)}}updateAutoScroll(){if(this.autoScrollRaf!==void 0)return;let{x:e,y:t}=this.edgeOverflow();(e!==0||t!==0)&&(this.autoScrollRaf=requestAnimationFrame(this.autoScrollTick))}autoScrollTick=()=>{if(this.autoScrollRaf=void 0,!this.selecting)return;let e=this.edgeOverflow(),t=Nr(e.x),n=Nr(e.y);if(t===0&&n===0)return;let r=this.grid.container,i=r.scrollLeft,a=r.scrollTop;r.scrollLeft+=t,r.scrollTop+=n,this.grid.model.onScroll(),this.extendSelection(),(r.scrollLeft!==i||r.scrollTop!==a)&&(this.autoScrollRaf=requestAnimationFrame(this.autoScrollTick))};stopAutoScroll(){this.autoScrollRaf!==void 0&&(cancelAnimationFrame(this.autoScrollRaf),this.autoScrollRaf=void 0)}onKeyDown=e=>{if(!this.fromEditableControl(e.target)){if(e.altKey&&e.key===`ArrowDown`&&!this.model.options.disableFiltering){let t=this.model.models.focus.focus,n=t?String(t.columnKey):void 0,r=n?this.model.data.columns.find(e=>String(e.key)===n):void 0;if(r&&r.filterType!==null&&!T(r)){e.preventDefault(),e.stopPropagation();let t=this.root.querySelector(`[data-type="header-cell"][data-column-key="${CSS.escape(String(r.key))}"]`)??this.root;yr(this.model,String(r.key),{anchor:t});return}}this.model.events.content.onKeyDown.send(e)}};fromEditableControl(e){let t=e;return!!(t&&t!==this.root&&t.closest?.(`input, textarea, select, [contenteditable='true']`))}onCopy=e=>{this.model.models.copyPaste.enabled&&(this.fromEditableControl(e.target)||this.model.models.copyPaste.writeToEvent(e)&&e.preventDefault())};onCut=e=>{this.model.models.copyPaste.enabled&&(this.fromEditableControl(e.target)||this.model.models.copyPaste.writeToEvent(e)&&(e.preventDefault(),this.model.options.editable&&this.model.models.editing.deleteRange()))};onPaste=e=>{this.model.models.copyPaste.enabled&&(this.fromEditableControl(e.target)||this.model.models.copyPaste.pasteFromEvent(e)&&e.preventDefault())};onClick=e=>{if(this.suppressClick){this.suppressClick=!1;return}if(this.resizing)return;let t=e.target?.closest?.(`[data-avg-action]`);if(t&&this.root.contains(t)){let e=this.model.models.structure;t.getAttribute(`data-avg-action`)===`add-row`?e.addBlankRows(1):e.addBlankColumns(1),this.root.focus({preventScroll:!0});return}let n=this.headerAt(e.target);if(n){if(n.el.getAttribute(`data-column-key`)===`--select-column--`){this.model.models.selected.toggleAll();return}let t=e.target?.closest?.(`[data-type="filter-button"]`);if(t){e.stopPropagation();let r=n.el.getAttribute(`data-column-key`);r&&(this.model.flags.filterPopover?.columnKey===r?this.model.flags.filterPopover.close():yr(this.model,r,{anchor:t}));return}let r=n.el.getAttribute(`data-column-key`);r&&this.model.events.onSortColumn.send({columnKey:r,append:e.ctrlKey||e.metaKey});return}let r=this.dataCellAt(e.target);if(r){let t=this.model.cellContext(r.row,r.col);if(t){if(String(t.column.key)===`--select-column--`){this.model.models.selected.toggleSelected(t.rowKey);return}this.model.events.cell.onClick.send({e,row:t.row,col:t.column,rowIndex:r.row,colIndex:r.col}),this.model.options.onCellClick?.(t,e)}}};onDoubleClick=e=>{let t=this.dataCellAt(e.target);if(!t)return;let n=this.model.cellContext(t.row,t.col);n&&(this.model.events.cell.onDoubleClick.send({e,row:n.row,col:n.column,rowIndex:t.row,colIndex:t.col}),this.model.options.onCellDoubleClick?.(n,e))};onContextMenu=e=>{let t=this.dataCellAt(e.target),n;if(!t&&e.target===this.root){let e=this.model.models.focus.getGridFocus(),r=e?this.root.querySelector(`[data-type="data-cell"][data-row="${e.rowIndex}"][data-col="${e.colIndex}"]`):null;e&&r&&(t={el:r,row:e.rowIndex,col:e.colIndex},n=r.getBoundingClientRect())}if(t){let n=this.model.cellContext(t.row,t.col);n&&(this.model.events.cell.onContextMenu.send({e,row:n.row,col:n.column,rowIndex:t.row,colIndex:t.col}),this.model.options.onCellContextMenu?.(n,e))}if(this.model.options.disableContextMenu)return;let r=e.target;if(this.model.models.editing.isEditing&&(r?.tagName===`INPUT`||r?.tagName===`TEXTAREA`||r?.closest?.(`.avg-editing`)))return;let i=this.headerAt(e.target),a=t?{target:`cell`,rowIndex:t.row,colIndex:t.col}:i?{target:`header`,colIndex:i.col}:{target:`grid`},o=Er(this.model,e,a);n&&(o.x=n.left+4,o.y=n.bottom-2),Dr(this.model,o)&&e.preventDefault()};onPointerMove=e=>{this.pointerX=e.clientX,this.pointerY=e.clientY,this.hasPointer=!0;let t=this.dataCellAt(e.target);this.setHovered(t?t.row:-1,t?t.col:-1)};onPointerLeave=()=>{this.hasPointer=!1,this.setHovered(-1,-1)};refreshHoverFromPoint(){if(!this.hasPointer&&!this.selecting)return;let e=this.dataCellAt(this.root.ownerDocument.elementFromPoint(this.pointerX,this.pointerY));this.setHovered(e?e.row:-1,e?e.col:-1)}onScrolled=()=>{this.model.models.editing.onViewportScrolled(),!(!this.hasPointer&&!this.selecting)&&this.hoverRaf===void 0&&(this.hoverRaf=requestAnimationFrame(()=>{this.hoverRaf=void 0,this.refreshHoverFromPoint()}))};setHovered(e,t){let n=this.model.data.hovered;if(n.row===e&&n.col===t)return;let r=n.row;this.model.data.hovered={row:e,col:t},this.model.data.change();let i=[];r>=0&&i.push(this.model.dataRowToGridRow(r)),e>=0&&i.push(this.model.dataRowToGridRow(e)),i.length&&this.model.update({rows:i})}onDragStart=e=>{let t=this.headerAt(e.target);if(!t||this.resizing||this.model.data.hasGroups){e.preventDefault();return}let n=t.el.getAttribute(`data-column-key`);n&&(e.dataTransfer?.setData(kr,n),e.dataTransfer&&(e.dataTransfer.effectAllowed=`move`),this.model.flags.dragColumnKey=n,this.repaintHeader())};columnBand(e){let t=this.model.models.columns.indexOfKey(e);if(t<0)return;let n=this.model.data;return t<=n.lastIsStatusIndex?`left`:t>=n.columns.length-n.stickyRightCount?`right`:`scroll`}reorderAllowed(e,t){return t===void 0||this.model.data.hasGroups?!1:this.columnBand(e)===this.columnBand(t)}onDragOver=e=>{let t=this.model.flags.dragColumnKey;if(!t)return;let n=this.headerAt(e.target)?.el.getAttribute(`data-column-key`)??void 0,r=n===void 0||this.reorderAllowed(t,n);r&&(e.preventDefault(),e.dataTransfer&&(e.dataTransfer.dropEffect=`move`));let i=r?n:void 0;this.model.flags.dragOverColumnKey!==i&&(this.model.flags.dragOverColumnKey=i,this.repaintHeader())};onDrop=e=>{e.preventDefault();let t=e.dataTransfer?.getData(kr)||this.model.flags.dragColumnKey,n=this.headerAt(e.target)?.el.getAttribute(`data-column-key`);this.clearDragState(),t&&n&&t!==n&&this.reorderAllowed(t,n)&&this.model.events.onColumnsReorder.send({sourceKey:t,targetKey:n})};onDragEnd=()=>{this.clearDragState()};clearDragState(){(this.model.flags.dragColumnKey!==void 0||this.model.flags.dragOverColumnKey!==void 0)&&(this.model.flags.dragColumnKey=void 0,this.model.flags.dragOverColumnKey=void 0,this.repaintHeader())}repaintHeader(){this.model.update({rows:[0]})}get owner(){return this.grid}};function Fr(e,t){let n=e.value;if(!n)return 0;let r=e.ownerDocument,i=e.parentElement??r.body;if(!i||typeof r.createRange!=`function`)return;let a=getComputedStyle(e),o=r.createElement(`span`);o.style.cssText=`position:absolute;top:0;left:-9999px;visibility:hidden;white-space:pre;pointer-events:none;margin:0;padding:0;border:0`,o.style.font=a.font,o.style.letterSpacing=a.letterSpacing,o.textContent=n,i.append(o);try{let i=o.firstChild;if(!i)return;let s=r.createRange();if(typeof s.getBoundingClientRect!=`function`)return;let c=e=>(s.setStart(i,0),s.setEnd(i,e),s.getBoundingClientRect().width),l=c(n.length);if(!(l>0))return;let u=e.getBoundingClientRect(),d=e=>parseFloat(e)||0,f=u.left+d(a.borderLeftWidth)+d(a.paddingLeft),p=u.right-d(a.borderRightWidth)-d(a.paddingRight),m=a.textAlign,h=t-(m===`right`||m===`end`?p-l:m===`center`?f+(p-f-l)/2:f);if(h<=0)return 0;if(h>=l)return n.length;let g=0,_=n.length;for(;_-g>1;){let e=g+_>>1;c(e)<=h?g=e:_=e}return h-c(g)<=c(_)-h?g:_}finally{o.remove()}}function Ir(e){let t=document.createElement(`input`);return t.className=`avg-cell-editor`,t.type=`text`,t.setAttribute(`data-type`,`cell-editor`),t.value=e.value===null||e.value===void 0?``:String(e.value),t.addEventListener(`input`,()=>e.setValue(t.value)),t.addEventListener(`keydown`,t=>{switch(t.key){case`Enter`:t.preventDefault(),e.commit();break;case`Escape`:t.preventDefault(),e.cancel();break;case`Tab`:case`ArrowUp`:case`ArrowDown`:t.preventDefault(),e.commitAndPass(t);break;default:t.stopPropagation()}}),t.addEventListener(`blur`,()=>e.commit()),t.addEventListener(`pointerdown`,e=>e.stopPropagation()),t.addEventListener(`dblclick`,e=>e.stopPropagation()),{element:t,focus:()=>{if(t.focus(),e.openedBy===`key`){t.select();return}let n=t.value.length,r=e.openedBy===`pointer`&&e.pointerX!==void 0?Fr(t,e.pointerX)??n:n;t.setSelectionRange?.(r,r)}}}var Lr=38,Rr=24,zr=86,Br=320;function $(e){return e==null?``:String(e)}function Vr(e){let t=e.openedBy===`typing`,n=t?e.row[e.column.key]:e.value,r=t?$(e.value):``,i=document.createElement(`div`);i.className=`avg-cell-editor avg-cell-select`,i.setAttribute(`data-type`,`cell-editor`),i.tabIndex=-1,i.innerHTML=`<span class="avg-cell-select-value"></span><span class="avg-cell-select-caret">${nt}</span>`;let a=i.firstElementChild;a.textContent=$(n);let o=new sr({className:`avg-cell-select-list`,multiple:!1,search:!0,searchPlaceholder:`search…`,emptyLabel:`no options`,onActivate:e=>f(Number(e.value))});r&&o.setSearch(r);let s=new tr({anchor:i,placement:`bottom-start`,offset:[0,1],className:`avg-cell-select-popover`,matchAnchorWidth:!0,autoFocus:!1});s.content.appendChild(o.element),s.root.addEventListener(`keydown`,p);let c=[],l=!1,u=!1;function d(e){if(u)return;let t=$(n);c=e.some(e=>$(e)===t)?[...e]:[n,...e],o.setItems(c.map((e,t)=>({value:t,label:$(e)})));let r=c.findIndex(e=>$(e)===t);if(r>=0){o.setSelected([r]);let e=o.getVisibleItems().findIndex(e=>e.value===r);e>=0&&(o.setActiveIndex(e),o.scrollToIndex(e,`center`))}s.content.style.height=`${Math.min(Br,Math.max(zr,Lr+c.length*Rr))}px`,s.reposition(),o.measure()}function f(t){t<0||t>=c.length||(l=!0,e.setValue(c[t]),s.close(),e.commit())}function p(t){if(t.key!==`Tab`)return;t.preventDefault();let n=o.getActiveItem();n&&(l=!0,e.setValue(c[Number(n.value)])),s.close(),e.commitAndPass(t)}return{element:i,focus:()=>{i.focus({preventScroll:!0}),s.show().then(()=>{!l&&!u&&e.cancel()});let t=e.column.options,n=typeof t==`function`?t():t??[];n instanceof Promise?(d([]),n.then(d,e=>{console.warn(`av-grid: column options failed to resolve:`,e),d([])})):d(n),o.focus()},destroy:()=>{u=!0,s.root.removeEventListener(`keydown`,p),s.destroy(),o.destroy(),i.remove()}}}function Hr(e){return e.column.options?Vr(e):Ir(e)}var Ur=25,Wr=`(empty)`,Gr=[0,4];function Kr(e,t){if(e?.value instanceof Date)return f(e.value,t);let n=e?.label??String(e?.value??``);return n.length?n:Wr}function qr(e,t){let n=Array.isArray(e.value)?[...e.value]:[],r=``;for(;r.length<t&&n.length;){let i=Kr(n.shift(),e.displayFormat);r.length+i.length>t&&(i=i.substring(0,t-r.length)),r+=`${r?`,`:``}${i}`}return n.length?`${r} (+${n.length})`:r}function Jr(e,t,n){let r=n?.filter;if(r)try{return r.label(e.value,n)}catch(t){return console.warn(`av-grid: the "${r.name}" filter's \`label\` threw for column "${e.columnKey}":`,t),r.name}return qr(e,t)}function Yr(e,t){return t?.filter?Jr(e,Ur,t):(Array.isArray(e.value)?e.value:[]).map(t=>Kr(t,e.displayFormat)).join(`, `)}function Xr(e,t){let n=e.data.columns.find(e=>String(e.key)===t.columnKey),r=t.columnName??t.columnKey;return{name:r,values:Jr(t,Ur,n),title:`${r}: ${Yr(t,n)}`}}var Zr=class{element;model;chips;clearButton;subscription;chipElements=new Map;openKey;destroyed=!1;constructor(e){this.model=e.model;let t=document;this.element=t.createElement(`div`),this.element.className=[`avg-filter-bar`,e.className].filter(Boolean).join(` `),this.element.setAttribute(`data-type`,`filter-bar`),e.name&&this.element.setAttribute(`data-name`,e.name),this.chips=t.createElement(`div`),this.chips.className=`avg-filter-bar-chips`,this.element.append(this.chips),e.clearButton!==!1&&(this.clearButton=cr(tt,`clear-all`,{title:`Remove all filters`,className:`avg-filter-bar-clear`}),this.element.append(this.clearButton)),this.element.addEventListener(`click`,this.onClick),this.subscription=this.model.events.onFiltersChanged.subscribe(this.refresh),this.refresh()}refresh=()=>{if(this.destroyed)return;let e=this.model.models.filters.filters,t=[],n=new Set;for(let r of e){let e=r.columnKey,i=this.columnFor(e),a=this.signature(r,i),o=this.chipElements.get(e);(!o||o.getAttribute(`data-signature`)!==a)&&(o=this.buildChip(r,a,i),this.chipElements.set(e,o)),n.add(e),t.push(o)}for(let e of Array.from(this.chipElements.keys()))n.has(e)||this.chipElements.delete(e);this.chips.replaceChildren(...t),this.element.classList.toggle(`avg-filter-bar-empty`,!e.length),this.syncOpen()};destroy(){this.destroyed||(this.destroyed=!0,this.element.removeEventListener(`click`,this.onClick),this.subscription.unsubscribe(),this.openKey&&this.model.flags.filterPopover?.columnKey===this.openKey&&this.model.flags.filterPopover.close(),this.chipElements.clear(),this.element.remove())}signature(e,t){return`${e.columnName??e.columnKey} ${Jr(e,Ur,t)}`}columnFor(e){return this.model.data.columns.find(t=>String(t.key)===e)}buildChip(e,t,n){let r=document.createElement(`span`);r.className=`avg-filter-chip`,r.setAttribute(`data-signature`,t),r.setAttribute(`data-column-key`,e.columnKey);let i=document.createElement(`span`);i.className=`avg-filter-chip-body`,i.setAttribute(`data-action`,`edit`),i.title=`${e.columnName??e.columnKey}: ${Yr(e,n)}`;let a=document.createElement(`span`);a.className=`avg-filter-chip-name`,a.textContent=`${e.columnName??e.columnKey}:`;let o=document.createElement(`span`);o.className=`avg-filter-chip-values`,o.textContent=Jr(e,Ur,n);let s=document.createElement(`span`);return s.className=`avg-filter-chip-caret`,s.innerHTML=nt,i.append(a,o,s),r.append(i,cr(tt,`remove`,{title:`Remove filter`,className:`avg-filter-chip-remove`})),r}syncOpen(){for(let[e,t]of this.chipElements){let n=e===this.openKey;t.classList.toggle(`avg-filter-chip-open`,n);let r=t.querySelector(`.avg-filter-chip-caret`);r&&(r.innerHTML=n?rt:nt)}}onClick=e=>{let t=e.target?.closest?.(`[data-action]`);if(!t||!this.element.contains(t))return;let n=t.getAttribute(`data-action`);if(n===`clear-all`){this.model.models.filters.clearFilters();return}let r=t.closest(`.avg-filter-chip`)?.getAttribute(`data-column-key`);r&&(n===`remove`?this.model.models.filters.removeFilter(r):n===`edit`&&this.edit(r,t))};async edit(e,t){if(this.model.flags.filterPopover?.columnKey===e){this.model.flags.filterPopover.close();return}this.openKey=e,this.syncOpen();try{await yr(this.model,e,{anchor:t,offset:Gr})}finally{this.openKey===e&&(this.openKey=void 0,this.syncOpen())}}},Qr=4,$r=1,ei=`400px`;function ti(e){return e.clientHeight>0?`100%`:ei}var ni=class e{static version=`2.6.1`;model;render;interactions;groupHeader;dataSubscription;groupRowHeightFn;groupRowHeightBase;destroyed=!1;warnedAfterDestroy=!1;sizeCheckRaf;addRowButton;addColumnButton;extraElement;wrapper;filterBar;static create(t,n){return new e(t,n)}static createFilterBar(e,t){let n=kt(e);if(!t?.grid?.model)throw new V("AVGrid.createFilterBar(container, { grid }): `grid` must be the grid this bar filters — what AVGrid.create() returned.");t.grid.model.options.injectStyles!==!1&&Rn(n.ownerDocument);let r=new Zr({model:t.grid.model,className:t.className,name:t.name,clearButton:t.clearButton});return n.appendChild(r.element),r}constructor(e,t){let n=kt(e),r=Gt(t);r.injectStyles!==!1&&Rn(n.ownerDocument),this.model=new Tn(r),r.filterBar&&(this.wrapper=n.ownerDocument.createElement(`div`),this.wrapper.className=`avg-grid-wrap`,r.growToHeight||(this.wrapper.style.height=ti(n)),n.appendChild(this.wrapper));let i=e=>e.row===0?$n(this.model,e):e.row>this.model.data.rows.length?Xn(this.model,e):Jn(this.model,e);this.render=new Fn(this.wrapper??n,{name:r.name,className:[`avg-grid`,r.className].filter(Boolean).join(` `),rowCount:()=>this.model.models.rows.rowCount,columnCount:()=>this.model.models.columns.columnCount,columnWidth:this.model.models.columns.getColumnWidth,rowHeight:this.engineRowHeight(),renderCell:i,stickyTop:1,stickyLeft:this.model.data.lastIsStatusIndex+1,stickyRight:this.model.data.stickyRightCount,stickyBottom:r.footerRows?.length??0,overscanRow:r.overscanRow??Qr,overscanColumn:r.overscanColumn??$r,fitToWidth:r.fitToWidth,whiteSpaceY:r.whiteSpaceY,height:r.growToHeight?void 0:this.wrapper?`auto`:ti(n),growToHeight:r.growToHeight,growToWidth:r.growToWidth}),r.cellBorders===!1&&this.render.root.setAttribute(`data-cell-borders`,`off`),this.render.root.setAttribute(`role`,`grid`),this.render.root.setAttribute(`aria-multiselectable`,`true`),this.syncAria(),this.syncSearchHighlight(),!r.growToHeight&&n.clientHeight===0&&(this.sizeCheckRaf=requestAnimationFrame(()=>{this.sizeCheckRaf=void 0,!(this.destroyed||n.clientHeight===0)&&((this.wrapper??this.render.root).style.height=`100%`,this.render.model.checkSize())})),r.filterBar&&this.wrapper&&(this.filterBar=new Zr({model:this.model}),this.wrapper.insertBefore(this.filterBar.element,this.render.root)),this.model.models.editing.createEditor=Hr,this.model.setRenderModel(this.render.model),this.interactions=new Pr(this.model,this.render),this.groupHeader=new Me(this.model,this.render),this.dataSubscription=this.model.data.onChange.subscribe(this.onDataChange),this.syncAffordances(),this.model.models.focus.initFocus(r.focus??void 0),this.model.update({all:!0})}get element(){return this.render.root}getFilterBar(){return this.filterBar}getRows(){return this.model.options.rows}getVisibleRows(){return this.model.data.rows}setRows(e){if(!Array.isArray(e))throw new V(`grid.setRows(rows): rows must be an array. Pass [] to empty the grid.`);this.alive(`grid.setRows()`)&&this.model.setRows(e)}getColumns(){return this.model.options.columns}setColumns(e){this.alive(`grid.setColumns()`)&&this.model.setColumns(zt(e,this.model.options.rows,this.knownColumnKeys()))}knownColumnKeys(){return new Set(this.model.options.columns.map(e=>String(e.key)))}addRows(e,t){if(!Array.isArray(e))throw new V(`grid.addRows(rows, index?): rows must be an array of row objects.`);return this.alive(`grid.addRows()`)?this.model.models.structure.addRows(e,t,!0):[]}addRow(e){if(this.alive(`grid.addRow()`))return this.model.models.structure.addBlankRows(1,e)[0]}deleteRows(e){if(!Array.isArray(e))throw new V(`grid.deleteRows(rowKeys): rowKeys must be an array of row keys — what getRowKey returns, not row objects or indices.`);return this.alive(`grid.deleteRows()`)?this.model.models.structure.deleteRows([...e],!0):!1}deleteSelectedRows(){return this.alive(`grid.deleteSelectedRows()`)?this.model.models.structure.deleteSelectedRows():!1}addColumns(e,t){return this.alive(`grid.addColumns()`)?this.model.models.structure.addColumns(zt(e,this.model.options.rows,new Set(e.map(e=>String(e?.key)))),t):[]}addColumn(e){if(this.alive(`grid.addColumn()`))return this.model.models.structure.addBlankColumns(1,e)[0]}deleteColumns(e){return this.alive(`grid.deleteColumns()`)?this.model.models.structure.deleteColumns([...e]):!1}getSort(){return this.model.models.sortColumn.reported}setSort(e){this.alive(`grid.setSort()`)&&this.model.setSort(Ht(e??void 0,this.model.data.columns,this.model.options.multiSort))}getSearchString(){return this.model.options.searchString}setSearchString(e){this.alive(`grid.setSearchString()`)&&this.model.setSearchString(e)}getFilters(){return this.model.models.filters.getFilters()}setFilters(e){this.alive(`grid.setFilters()`)&&this.model.setFilters(e)}applyFilter(e){this.alive(`grid.applyFilter()`)&&this.model.models.filters.applyFilter(e)}removeFilter(e){this.alive(`grid.removeFilter()`)&&this.model.models.filters.removeFilter(e)}clearFilters(){this.alive(`grid.clearFilters()`)&&this.model.models.filters.clearFilters()}showFilterPopover(e,t){return this.alive(`grid.showFilterPopover()`)?yr(this.model,e,t):Promise.resolve(void 0)}isFiltered(e){return this.model.models.filters.isFiltered(e)}describeFilter(e){return Xr(this.model,e)}getSelected(){return this.model.models.selected.getSelectedKeys()}getSelectedRows(){return this.model.models.selected.getSelectedRows()}setSelected(e){this.alive(`grid.setSelected()`)&&this.model.models.selected.setSelected(e)}isSelected(e){return this.model.models.selected.isSelected(e)}toggleSelected(e){this.alive(`grid.toggleSelected()`)&&this.model.models.selected.toggleSelected(e)}selectAll(){this.alive(`grid.selectAll()`)&&this.model.models.selected.selectAll()}clearSelected(){this.alive(`grid.clearSelected()`)&&this.model.models.selected.clearSelected()}startEdit(e,t){this.alive(`grid.startEdit()`)&&this.model.models.editing.openEdit(e,t)}isEditing(){return this.model.models.editing.isEditing}getEdit(){return this.model.models.editing.edit}commitEdit(){this.alive(`grid.commitEdit()`)&&this.model.models.editing.commitEdit()}cancelEdit(){this.alive(`grid.cancelEdit()`)&&this.model.models.editing.cancelEdit()}setCellValue(e,t,n){return this.alive(`grid.setCellValue()`)?this.model.models.editing.editCellAt(e,t,n):!1}copySelection(e=`copy`){return this.alive(`grid.copySelection()`)?this.model.models.copyPaste.copySelection(e):Promise.resolve(!1)}getSelectionText(e=`copy`){return this.model.models.copyPaste.selectionText(e)}paste(){return this.alive(`grid.paste()`)?this.model.models.copyPaste.paste():Promise.resolve(!1)}pasteText(e){return this.alive(`grid.pasteText()`)?this.model.models.copyPaste.pasteText(e):!1}cut(){return this.alive(`grid.cut()`)?this.model.models.copyPaste.cut():Promise.resolve(!1)}getFocus(){return this.model.models.focus.focus}setFocus(e){this.alive(`grid.setFocus()`)&&this.model.models.focus.setFocus(e)}clearFocus(){this.alive(`grid.clearFocus()`)&&this.model.models.focus.clearFocus()}focusCell(e,t,n=!1){this.alive(`grid.focusCell()`)&&this.model.models.focus.focusCell(e,t,n)}selectRange(e,t,n,r){this.alive(`grid.selectRange()`)&&this.model.models.focus.selectRange(e,t,n,r)}getSelection(){return this.model.models.focus.getGridSelection()}focus(){this.alive(`grid.focus()`)&&this.model.focusGrid()}setOptions(e){if(!this.alive(`grid.setOptions()`))return;`columns`in e&&e.columns&&this.setColumns(e.columns),`rows`in e&&e.rows&&this.setRows(e.rows),`searchString`in e&&this.setSearchString(e.searchString),`filters`in e&&this.setFilters(e.filters),`multiSort`in e&&(this.model.options.multiSort=!!e.multiSort,this.model.models.sortColumn.normalizeArity()),`sort`in e&&this.setSort(e.sort??void 0);let t={...e};delete t.columns,delete t.rows,delete t.searchString,delete t.filters,delete t.sort,delete t.multiSort,delete t.selected,delete t.focus,`getRowKey`in t&&t.getRowKey===void 0&&(t.getRowKey=It(this.model.options.rows)),`rowHeight`in t&&t.rowHeight===void 0&&(t.rowHeight=24),Object.assign(this.model.options,t),`selectColumn`in e&&this.model.models.columns.updateColumnsData(this.model.options.columns),`filterBar`in e&&this.syncFilterBar(),(`highlightSearch`in e||`highlightString`in e)&&(this.syncSearchHighlight(),this.model.syncSearchWords(),this.model.requestRepaint()),`selected`in e&&this.setSelected(e.selected),`focus`in e&&this.setFocus(e.focus??void 0),e.editable===!1&&this.model.models.editing.cancelEdit(),(`columnGroupRender`in t||`columnGroupClass`in t)&&this.groupHeader.markDirty(),`cellBorders`in t&&(t.cellBorders===!1?this.render.root.setAttribute(`data-cell-borders`,`off`):this.render.root.removeAttribute(`data-cell-borders`)),`className`in t&&this.render.setOptions({className:[`avg-grid`,t.className].filter(Boolean).join(` `)}),`rowHeight`in t&&this.render.setOptions({rowHeight:this.engineRowHeight()}),`fitToWidth`in t&&this.render.setOptions({fitToWidth:t.fitToWidth??!1}),`overscanRow`in t&&this.render.setOptions({overscanRow:t.overscanRow??Qr}),`overscanColumn`in t&&this.render.setOptions({overscanColumn:t.overscanColumn??$r}),`whiteSpaceY`in t&&this.render.setOptions({whiteSpaceY:t.whiteSpaceY}),`footerRows`in t&&(this.render.setOptions({stickyBottom:this.model.options.footerRows?.length??0}),this.syncAria()),this.syncAffordances(),this.refresh()}isDestroyed(){return this.destroyed}getState(){let t=this.model.models.editing.edit,n=S(this.model.state.get().sort),{getColumnWidth:r}=this.model.models.columns,i=!!this.model.options.editable;return{version:e.version,name:this.model.options.name,destroyed:this.destroyed,rowCount:this.model.data.rows.length,sourceRowCount:this.model.options.rows.length,columnCount:this.model.data.columns.length,columns:this.model.data.columns.map((e,t)=>{let a=String(e.key);return{key:a,name:e.name??a,width:r(t),dataType:e.dataType,align:e.align,sorted:n.find(e=>e.key===a)?.direction,filtered:this.model.models.filters.isFiltered(a),editable:i&&!e.readonly&&!T(e),isStatusColumn:e.isStatusColumn,pinned:e.pinned??(T(e)?`left`:void 0),hasRender:!!e.render,hasOptions:!!e.options,hasEditor:!!e.editor,filterType:e.filterType===null?null:e.filter?.name??e.filterType??`options`}}),sort:this.model.models.sortColumn.reported,searchString:this.model.options.searchString,filters:this.model.models.filters.getFilters(),rowHeight:this.model.options.rowHeight,focus:this.model.models.focus.focus,selectedCount:this.model.models.selected.count,allSelected:this.model.models.selected.allSelected,editing:t?{rowKey:t.rowKey,columnKey:String(t.columnKey),changed:!!t.changed}:void 0,viewport:this.viewportState()}}viewportState(){let{visible:e}=this.render.model.renderInfo.current,{offset:t,size:n}=this.render.model,r=this.model.data.rows.length;return{firstRow:r?Math.max(0,e.top-1):-1,lastRow:r?Math.min(r-1,e.bottom-1):-1,firstColumn:e.left,lastColumn:e.right,scrollTop:t.y,scrollLeft:t.x,width:n.width??0,height:n.height??0}}refresh(){this.alive(`grid.refresh()`)&&this.model.update({all:!0})}revalidate(){this.alive(`grid.revalidate()`)&&this.render.revalidate()}scrollToRow(e,t=`nearest`){return this.alive(`grid.scrollToRow()`)?this.render.model.scrollToRow(this.model.dataRowToGridRow(e),t):Promise.resolve()}scrollToRowAfterPaint(e,t=`nearest`){this.alive(`grid.scrollToRowAfterPaint()`)&&this.render.model.scrollToRowAfterPaint(this.model.dataRowToGridRow(e),t)}scrollToCell(e,t){return this.alive(`grid.scrollToCell()`)?this.render.model.scrollTo(this.model.dataRowToGridRow(e),t):Promise.resolve()}destroy(){this.destroyed||(this.model.models.editing.cancelEdit(),this.model.flags.filterPopover?.close(),this.model.flags.contextMenu?.close(),this.destroyed=!0,this.sizeCheckRaf!==void 0&&(cancelAnimationFrame(this.sizeCheckRaf),this.sizeCheckRaf=void 0),this.dataSubscription.unsubscribe(),this.groupHeader.destroy(),this.interactions.destroy(),this.model.setRenderModel(null),this.render.destroy(),this.filterBar?.destroy(),this.filterBar=void 0,this.wrapper?.remove(),this.addRowButton?.remove(),this.addRowButton=void 0,this.addColumnButton?.remove(),this.addColumnButton=void 0,this.extraElement?.remove(),this.extraElement=void 0,this.model.dispose())}alive(e){return!this.destroyed||(this.warnedAfterDestroy||(this.warnedAfterDestroy=!0,console.warn(`av-grid: ${e} was called on a grid that has been destroyed. It did nothing. Create a new grid with AVGrid.create() — a destroyed one cannot be revived.`)),!1)}syncSearchHighlight(){let e=this.model.options.highlightSearch;e===`background`||e===`both`?this.render.root.setAttribute(`data-search-highlight`,e):this.render.root.removeAttribute(`data-search-highlight`)}syncFilterBar(){let e=!!this.model.options.filterBar;if(e!==!!this.filterBar){if(!e){this.filterBar?.destroy(),this.filterBar=void 0;return}if(!this.wrapper){console.warn(`av-grid: setOptions({ filterBar: true }) — this grid was created without one, so there is nowhere above it to put a bar. Pass filterBar at create(), or mount one yourself with AVGrid.createFilterBar(el, { grid }).`),this.model.options.filterBar=!1;return}this.filterBar=new Zr({model:this.model}),this.wrapper.insertBefore(this.filterBar.element,this.render.root)}}syncExtraElement(){let e=this.model.options.extraElement??void 0;e!==this.extraElement&&(this.extraElement?.remove(),this.extraElement=e,e&&(e.classList.add(`avg-extra`),e.setAttribute(`data-avg-slot`,`content-end`),this.render.addOverlay(e,`content`)))}syncAffordances(){let e=this.render.root.ownerDocument,{canAddRows:t,canAddColumns:n,addRowLabel:r,rowNoun:i}=this.model.options;if(t){this.addRowButton||(this.addRowButton=e.createElement(`button`),this.addRowButton.type=`button`,this.addRowButton.tabIndex=-1,this.addRowButton.className=`avg-add-row`,this.addRowButton.setAttribute(`data-avg-action`,`add-row`),this.render.addOverlay(this.addRowButton,`content`));let t=r??`add ${i??`row`}`;this.addRowButton.textContent=`+ ${t}`,this.addRowButton.title=`${t} (Ctrl+Insert)`}else this.addRowButton?.remove(),this.addRowButton=void 0;this.syncExtraElement(),n?this.addColumnButton||(this.addColumnButton=e.createElement(`button`),this.addColumnButton.type=`button`,this.addColumnButton.tabIndex=-1,this.addColumnButton.className=`avg-add-column`,this.addColumnButton.setAttribute(`data-avg-action`,`add-column`),this.addColumnButton.textContent=`+`,this.addColumnButton.title=`Add column (Ctrl+→)`,this.render.addOverlay(this.addColumnButton,`header`)):(this.addColumnButton?.remove(),this.addColumnButton=void 0)}syncAria(){let e=this.model.options.footerRows?.length??0;this.render.root.setAttribute(`aria-rowcount`,String(this.model.data.rows.length+1+e)),this.render.root.setAttribute(`aria-colcount`,String(this.model.data.columns.length))}engineRowHeight(){let e=this.model.options.rowHeight;return this.model.data.hasGroups?((!this.groupRowHeightFn||this.groupRowHeightBase!==e)&&(this.groupRowHeightBase=e,this.groupRowHeightFn=t=>t===0?e*2:e),this.groupRowHeightFn):e}onDataChange=e=>{this.destroyed||((e.rows||e.columns)&&this.syncAria(),e.lastIsStatusIndex&&this.render.setOptions({stickyLeft:this.model.data.lastIsStatusIndex+1}),e.stickyRightCount&&this.render.setOptions({stickyRight:this.model.data.stickyRightCount}),e.hasGroups&&this.render.setOptions({rowHeight:this.engineRowHeight()}))}},ri=[`onSelectionChange`,`onEdit`,`onInvalidEdit`,`onAddRows`,`onDeleteRows`,`onAddColumns`,`onDeleteColumns`,`onSortChange`,`onFiltersChange`,`onColumnResize`,`onColumnsReorder`,`onColumnsChange`,`onVisibleRowsChange`,`onFocusChange`,`onCellClick`,`onCellDoubleClick`,`onCellContextMenu`,`getContextMenuItems`,`onCellClass`,`rowClass`,`footerRowClass`,`columnGroupRender`,`columnGroupClass`],ii=[`onCellClass`,`rowClass`,`footerRowClass`],ai=50,oi=24,si=class{committed=[];pending=[];updaters=new Map;props;geometry=null;lastHeight=0;live=!0;isDisposed=!1;constructor(e){this.props=e}rowHeight=e=>{let t=this.committed[e];if(t!==void 0)return t;let n=this.props.getInitialRowHeight?.(e);return n===void 0?this.props.preferMinHeightForNewRows?this.props.minRowHeight||this.fallbackHeight:this.lastHeight||this.fallbackHeight:this.clamp(n)};get disposed(){return this.isDisposed}heightOf(e){return this.committed[e]}setProps(e){this.isDisposed||(this.props=e)}setGeometry(e){this.isDisposed||(this.geometry=e)}setRowHeight(e,t){if(!this.live||t===0)return;let n=this.clamp(t);this.pending[e]!==n&&(this.pending[e]=n,this.updaterFor(e)())}dispose(){if(!this.isDisposed){this.live=!1,this.isDisposed=!0,this.geometry=null;for(let e of this.updaters.values())e.cancel();this.updaters.clear()}}get fallbackHeight(){return typeof this.props.rowHeight==`number`?this.props.rowHeight:24}updaterFor(e){let t=this.updaters.get(e);return t||(t=r(()=>{this.live&&this.commit(e)},50,()=>this.live||this.isDisposed),this.updaters.set(e,t)),t}commit(e){let t=this.pending[e];t!==void 0&&this.committed[e]!==t&&(this.lastHeight=t,this.committed[e]=t,this.geometry?.update({fromRow:e}))}clamp(e){let t=this.props.maxRowHeight?Math.min(e,this.props.maxRowHeight):e;return Math.max(t,this.props.minRowHeight||24)}},ci=class{heights;grid;props;observer;rowByElement=new WeakMap;nominatedByCell=new WeakMap;pendingFrames=new Set;inert=!1;constructor(e,t){this.props=t,this.heights=new si(t),typeof ResizeObserver<`u`&&(this.observer=new ResizeObserver(this.onResize)),this.grid=new Fn(e,this.gridOptions(t)),this.heights.setGeometry(this.grid.model)}get model(){return this.grid.model}get root(){return this.grid.root}get scrollElement(){return this.grid.container}get stats(){return this.grid.stats}addOverlay(e,t=`content`){this.grid.addOverlay(e,t)}revalidate(){this.grid.revalidate()}setOptions(e){this.inert||(this.props={...this.props,...e},this.heights.setProps(this.props),this.grid.setOptions(this.gridOptions(this.props)))}destroy(){if(!this.inert){this.inert=!0;for(let e of this.pendingFrames)cancelAnimationFrame(e);this.pendingFrames.clear(),this.observer?.disconnect(),this.observer=void 0,this.rowByElement=new WeakMap,this.nominatedByCell=new WeakMap,this.heights.dispose(),this.grid.destroy()}}renderCell=e=>{let t,n=this.props.renderCell({...e,measure:e=>{t=e}});if(!n)return;let r=this.nominatedByCell.get(n),i=t??n;return r&&r!==i&&(this.observer?.unobserve(r),this.rowByElement.delete(r)),this.nominatedByCell.set(n,i),this.rowByElement.set(i,e.row),this.observer?.observe(i),this.heights.setRowHeight(e.row,i.clientHeight),n};onResize=e=>{if(!this.inert)for(let t of e){let e=t.target;if(!(e instanceof HTMLElement))continue;let n=this.rowByElement.get(e);n!==void 0&&this.heights.setRowHeight(n,e.clientHeight)}};onCellAttached=e=>{if(this.inert)return;let t=this.nominatedByCell.get(e);if(!t)return;let n=this.rowByElement.get(t);if(n===void 0||(this.heights.setRowHeight(n,t.clientHeight),typeof requestAnimationFrame!=`function`))return;let r=requestAnimationFrame(()=>{this.pendingFrames.delete(r),!this.inert&&this.nominatedByCell.get(e)===t&&this.rowByElement.get(t)===n&&this.heights.setRowHeight(n,t.clientHeight)});this.pendingFrames.add(r)};onCellReleased=e=>{let t=this.nominatedByCell.get(e)??e;this.observer?.unobserve(t),this.rowByElement.delete(t),this.nominatedByCell.delete(e),this.props.onCellReleased?.(e)};onCellAttachedForwarding=e=>{this.onCellAttached(e),this.props.onCellAttached?.(e)};gridOptions(e){let{renderCell:t,rowHeight:n,minRowHeight:r,maxRowHeight:i,getInitialRowHeight:a,preferMinHeightForNewRows:o,...s}=e;return{...s,rowHeight:this.heights.rowHeight,renderCell:this.renderCell,onCellAttached:this.onCellAttachedForwarding,onCellReleased:this.onCellReleased}}};e.AVGRID_STYLE_ID=In,e.AVGrid=ni,e.AVGridData=We,e.AVGridError=V,e.AVGridEvents=qe,e.AVGridModel=Tn,e.AsyncRef=On,e.CALLBACK_OPTION_KEYS=ri,e.CellPool=Dn,e.ColumnsModel=ht,e.CopyPasteModel=bt,e.CustomFilterContent=_r,e.DEFAULT_MIN_ROW_HEIGHT=oi,e.EditingModel=Ct,e.FILTERS_CONFIG_VERSION=Kt,e.FilterBar=Zr,e.FiltersModel=on,e.FocusModel=_n,e.MEASURED_ROW_DEBOUNCE_MS=ai,e.MENU_SEARCH_THRESHOLD=br,e.MENU_SUBMENU_DELAY_MS=xr,e.MeasuredRowGrid=ci,e.MeasuredRowHeights=si,e.Menu=wr,e.Model=Fe,e.OPTIONS_FILTER_MIN_WIDTH=lr,e.Observable=Pe,e.OptionsFilterContent=gr,e.PAINT_PATH_CALLBACK_KEYS=ii,e.Popover=tr,e.RenderGrid=Fn,e.RenderGridModel=Nn,e.RowsModel=vn,e.SELECT_COLUMN_KEY=lt,e.SelectedModel=yn,e.SortColumnModel=xn,e.StructureModel=Sn,e.Subscription=R,e.VirtualList=sr,e.avGridCss=Ln,e.calcRenderInfo=Ee,e.calcScrollOffset=ke,e.calcScrollOffsetX=De,e.calcScrollOffsetY=Oe,e.columnDisplayValue=D,e.createButton=X,e.createCellInput=Ir,e.createCellSelect=Vr,e.createDefaultEditor=Hr,e.createIconButton=cr,e.createSelectColumn=pt,e.csvToRecords=u,e.defaultColumnWidth=An,e.defaultCompare=d,e.defaultFilterOptions=nn,e.defaultGridColumnWidth=mt,e.defaultRowHeight=kn,e.defaultValidate=O,e.describeFilter=Xr,e.detectColumnWidth=Tt,e.detectColumnWidths=Dt,e.falseString=b,e.filterRows=y,e.filtersStorageKey=qt,e.formatDisplayValue=f,e.gridBoolean=x,e.gridContextMenuEvent=Er,e.gridContextMenuItems=Tr,e.hasStoredFilters=Qt,e.highlightText=Be,e.inferColumns=Pt,e.inferGetRowKey=It,e.inferRowKeyProperty=Ft,e.injectStyles=Rn,e.optionsFilterValues=qr,e.prepareRerender=pe,e.readStoredFilters=$t,e.recordsToCsv=c,e.renderInfoInitialState=me,e.reviveFilters=Zt,e.rowsToCsvText=te,e.searchWords=v,e.showFilterPopover=yr,e.showGridContextMenu=Dr,e.showMenu=Cr,e.validateFilters=Wt,e.version=`2.6.1`,e.whiteSpace=he,e.writeStoredFilters=en});
//# sourceMappingURL=av-grid.umd.cjs.map