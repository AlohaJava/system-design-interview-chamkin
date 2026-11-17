import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import MarkdownIt from 'markdown-it';
import GithubSlugger from 'github-slugger';
const md = new MarkdownIt({html:true});
const root=path.resolve(process.argv[2] || process.cwd());
const baseline=false;
const files=cp.execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(f=>f.endsWith('.md'));
const data=new Map(); const issues=[];
const plain=token=>(token.children||[]).map(c=>c.type==='image'?c.content:c.type==='html_inline'?'':c.content).join('');
const refs=t=>(t.children||[]).flatMap(x=>[...(x.type==='link_open'?[x.attrGet('href')]:[]),...refs(x)]);
function inspect(file,src){
 const ts=md.parse(src,{}), slugger=new GithubSlugger(), anchors=new Set(), headings=[], links=[];
 for(let i=0;i<ts.length;i++){
  const t=ts[i];
  const allowedTags=new Set(['a','details','summary','br','sub','sup','kbd','img','span','div','p','b','i','em','strong','h1','h2','h3','h4','h5','h6','table','tr','td','th','ul','li','ol','dl','dt','dd','blockquote','pre','code']);
  for(const child of [t,...(t.children||[])]){
   if(!child.type.startsWith('html_'))continue;
   for(const tag of child.content.matchAll(/<\/?([a-zA-Z][\w-]*)\b[^>]*>/g)){
    if(!allowedTags.has(tag[1].toLowerCase()))issues.push({file,line:(t.map?.[0]||0)+1,type:'unexpected-html-tag',href:tag[0]});
   }
  }
  if(t.type==='heading_open'){
   const text=plain(ts[i+1]);const slug=slugger.slug(text);anchors.add(slug);headings.push({level:+t.tag.slice(1),text,slug,line:t.map[0]+1});
  }
  for(const href of refs(t)) links.push({href,line:(t.map?.[0]||0)+1});
  if(t.type==='fence'){
   const lines=src.split('\n'),end=lines[t.map[1]-1]?.trim();
   if(!end?.match(new RegExp('^'+t.markup[0]+'{'+t.markup.length+',}\\s*$')))issues.push({file,line:t.map[0]+1,type:'unclosed-fence'});
   if(!t.info.trim())issues.push({file,line:t.map[0]+1,type:'unlabelled-fence'});
  }
 }
 for(const x of src.matchAll(/<(?:a|h[1-6])\b[^>]*\b(?:id|name)=["']([^"']+)["']/gi))anchors.add(x[1]);
 const opens=(src.match(/<details(?:\s[^>]*)?>/g)||[]).length,closes=(src.match(/<\/details>/g)||[]).length;
 if(opens!==closes)issues.push({file,type:'details-balance',opens,closes});
 let inFence=false;let fenceChar='',fenceLength=0;let columns=null;
 src.split('\n').forEach((line,i)=>{
  const f=line.match(/^\s*(`{3,}|~{3,})/);
  if(f){if(!inFence){inFence=true;fenceChar=f[1][0];fenceLength=f[1].length;}else if(f[1][0]===fenceChar&&f[1].length>=fenceLength)inFence=false;return;}
  if(inFence)return;
  if(/^\s*\|/.test(line)){
   const n=(line.match(/(?<!\\)\|/g)||[]).length-1;
   if(columns===null)columns=n;else if(n!==columns)issues.push({file,line:i+1,type:'table-columns',expected:columns,actual:n});
  }else columns=null;
 });
 return {anchors:[...anchors],headings,links,words:src.split(/\s+/).length};
}
for(const file of files){let src;try{src=baseline?cp.execFileSync('git',['show','HEAD:'+file],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}):fs.readFileSync(path.join(root,file),'utf8');}catch{continue;}data.set(file,inspect(file,src));}
for(const [file,v]of data)for(const link of v.links){
 const href=link.href;if(!href||/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href))continue;
 const parts=href.split('#');const dest=parts[0]?path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURIComponent(parts[0]))):file;
 if(!fs.existsSync(path.join(root,dest))){issues.push({file,line:link.line,type:'missing-file',href});continue;}
 if(parts[1]&&data.has(dest)&&!data.get(dest).anchors.includes(decodeURIComponent(parts[1])))issues.push({file,line:link.line,type:'missing-anchor',href});
}
const errors=issues.filter(x=>x.type!=='unlabelled-fence');
for(const item of issues) console.log(`${item.file}:${item.line||1}: ${item.type}${item.href?' '+item.href:''}`);
console.log(`${data.size} Markdown files checked; ${errors.length} errors; ${issues.length-errors.length} code blocks without a language.`);
if(errors.length)process.exitCode=1;
