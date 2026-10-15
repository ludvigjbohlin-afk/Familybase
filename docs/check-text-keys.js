const fs=require('fs');const s=fs.readFileSync(process.argv[2],'utf8');
const a=s.indexOf('const T = {'); let i=s.indexOf('{',a), d=0, j=i;
for(;j<s.length;j++){const c=s[j]; if(c==='"'||c==="'"||c==='`'){const q=c;j++;while(s[j]!==q){if(s[j]==='\\')j++;j++;}continue;} if(c==='{')d++; else if(c==='}'){d--; if(d===0)break;}}
const body=s.slice(i,j+1);
// walk top-level language objects
let depth=0, lang=null, keys={}, k=0;
for(let p=0;p<body.length;p++){const c=body[p];
 if(c==='"'||c==="'"||c==='`'){const q=c;p++;while(body[p]!==q){if(body[p]==='\\')p++;p++;}continue;}
 if(c==='{'||c==='['){depth++; if(depth===2&&c==='{'){const m=body.slice(0,p).match(/(\w+)\s*:\s*$/);lang=m?m[1]:'?';keys[lang]={};} continue;}
 if(c==='}'||c===']'){depth--;continue;}
 if(depth===2){const m=body.slice(p).match(/^([A-Za-z_]\w*)\s*:/); if(m&&/[\s,{]/.test(body[p-1])){keys[lang][m[1]]=(keys[lang][m[1]]||0)+1; p+=m[1].length;}}
}
let bad=0;for(const l in keys)for(const kk in keys[l])if(keys[l][kk]>1){console.log(l,kk,keys[l][kk]);bad++;}
console.log(bad?"DUPLICATES "+bad:"no duplicates", Object.keys(keys).map(l=>l+":"+Object.keys(keys[l]).length).join(" "));
