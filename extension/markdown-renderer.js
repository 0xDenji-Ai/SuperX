(function(root,factory) {
  'use strict';
  const api=factory(typeof module==='object'&&module.exports?require('./marked.umd.js'):root.marked,root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GrokFirstMarkdown=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(marked,root) {
  'use strict';

  // Parse Markdown into tokens, then construct a small, explicit set of DOM
  // elements. Generated HTML, image URLs and model-provided attributes never
  // reach an HTML parser or cause an additional resource request.
  const LIMITS=Object.freeze({text:30000,depth:32,nodes:12000,tokens:12000});
  const ENTITIES=Object.freeze({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',
    ndash:'\u2013',mdash:'\u2014',hellip:'\u2026',copy:'\u00a9',reg:'\u00ae',trade:'\u2122',
    laquo:'\u00ab',raquo:'\u00bb',middot:'\u00b7',bull:'\u2022'});
  function decodeEntities(value) {
    return String(value??'').replace(/&(#(?:[xX][\da-fA-F]{1,6}|\d{1,7})|[a-zA-Z]+);/g,(raw,name)=>{
      if(name[0]!=='#')return Object.prototype.hasOwnProperty.call(ENTITIES,name)?ENTITIES[name]:raw;
      const hexadecimal=/^#[xX]/.test(name),number=Number.parseInt(name.slice(hexadecimal?2:1),hexadecimal?16:10);
      return number===0||number>0x10ffff||(number>=0xd800&&number<=0xdfff)?'\ufffd':String.fromCodePoint(number);
    });
  }
  function sourceUrl(value) {
    try {const url=new URL(value);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url:null;}catch{return null;}
  }
  function markdownLinkStart(value,parser) {
    // Reuse the grammar without tokenizing the label or changing link state.
    // Ordinary URL brackets (including IPv6 hosts) remain URL characters.
    const rules=parser.tokenizer.rules.inline;
    if(rules.link.test(value))return true;
    const reference=rules.reflink.exec(value)||rules.nolink.exec(value);
    if(!reference)return false;
    const label=(reference[2]||reference[1]).replace(/\s+/g,' ').trim().toLowerCase().toUpperCase().toLowerCase();
    return Object.prototype.hasOwnProperty.call(parser.tokens.links,label);
  }
  function urlTokenEnd(value,start,parser) {
    let end=start,parentheses=0,brackets=0,backslashes=0;
    for(;end<value.length;end++) {
      const char=value[end],escaped=backslashes%2===1;
      backslashes=char==='\\'?backslashes+1:0;
      // Keep the URL/prose boundary used by GrokFirst 0.6.8: non-ASCII
      // letters are valid URL characters, but Chinese punctuation ends prose.
      if(/[\s<>"'`，。！？；：、（）【】《》「」『』“”‘’…]/u.test(char))break;
      if(char==='['&&!escaped&&!parentheses&&!brackets&&markdownLinkStart(value.slice(end),parser))break;
      if(char==='(')parentheses++;
      else if(char===')'){if(!parentheses)break;parentheses--;}
      else if(char==='[')brackets++;
      else if(char===']'){if(!brackets)break;brackets--;}
    }
    while(end>start&&/[.,;:!?]/.test(value[end-1]))end--;
    return end;
  }

  const lexer=marked?.Marked?new marked.Marked({gfm:true,breaks:true}):null;
  lexer?.use({extensions:[{
    name:'gfUrl',level:'inline',
    start(src) {const match=/https?:\/\//i.exec(src);return match?match.index:undefined;},
    tokenizer(src) {
      if(!/^https?:\/\//i.test(src))return undefined;
      const raw=src.slice(0,urlTokenEnd(src,0,this.lexer));
      if(!raw)return undefined;
      // Consume even an invalid address so Marked's more permissive default
      // autolinker cannot reinterpret credentials or swallow Chinese prose.
      if(this.lexer.state.inLink)return {type:'text',raw,text:raw};
      return {type:'gfUrl',raw,text:raw,href:raw};
    }
  }]});

  function render(target,text) {
    const core=root.XGrokCore||(typeof module==='object'&&module.exports?require('./feed-core.js'):null);
    const value=(core?.reviewScore?core.reviewScore(String(text??'')).text:String(text??'')).slice(0,LIMITS.text);
    try {
      const document=target.ownerDocument||root.document;
      if(!lexer||!document)throw new Error('Markdown renderer unavailable');
      const state={nodes:0,tokens:0};
      function budget(depth,token=false) {
        if(depth>LIMITS.depth||(token?++state.tokens>LIMITS.tokens:++state.nodes>LIMITS.nodes))throw new Error('Markdown rendering limit');
      }
      function element(tag) {budget(0);return document.createElement(tag);}
      function appendText(parent,value,decode=false) {
        const text=decode?decodeEntities(value):String(value??'');
        if(!text)return;
        budget(0);parent.append(document.createTextNode(text));
      }
      function inline(parent,tokens,depth=0,inLink=false) {
        for(const token of tokens||[]) {
          budget(depth,true);
          switch(token.type) {
            case 'text':
              if(Array.isArray(token.tokens))inline(parent,token.tokens,depth+1,inLink);
              // Marked already decodes numeric references in token.text.
              // Decode the original leaf once, so an encoded ampersand cannot
              // expose a second entity such as &#38;lt; to another decode pass.
              else appendText(parent,token.raw??token.text,true);
              break;
            case 'escape':appendText(parent,token.text,true);break;
            case 'html':case 'image':appendText(parent,token.raw);break;
            case 'strong':case 'em':case 'del': {
              const node=element(token.type);inline(node,token.tokens,depth+1,inLink);parent.append(node);break;
            }
            case 'codespan': {const node=element('code');appendText(node,token.text);parent.append(node);break;}
            case 'br':parent.append(element('br'));appendText(parent,'\n');break;
            case 'link':case 'gfUrl': {
              const href=decodeEntities(token.href),url=sourceUrl(href);
              if(!url||inLink){appendText(parent,token.raw);break;}
              const node=element('a');node.href=href;node.target='_blank';node.rel='noopener noreferrer';
              if(token.title)node.title=decodeEntities(token.title);
              if(Array.isArray(token.tokens))inline(node,token.tokens,depth+1,true);
              else appendText(node,token.text??token.raw,true);
              parent.append(node);break;
            }
            case 'checkbox':appendText(parent,token.checked?'[x] ':'[ ] ');break;
            default:appendText(parent,token.raw??token.text);
          }
        }
      }
      function blocks(parent,tokens,depth=0,tight=false) {
        for(const token of tokens||[]) {
          budget(depth,true);
          switch(token.type) {
            case 'space':appendText(parent,token.raw);break;
            case 'def':break; // Definitions are metadata for reference links.
            case 'paragraph': {
              const node=element('p');inline(node,token.tokens,depth+1);parent.append(node);break;
            }
            case 'heading': {
              const level=Math.max(1,Math.min(6,Number(token.depth)||1)),node=element('h'+level);
              inline(node,token.tokens,depth+1);parent.append(node);break;
            }
            case 'text': {
              const node=tight?parent:element('p');
              if(Array.isArray(token.tokens))inline(node,token.tokens,depth+1);
              else appendText(node,token.text??token.raw,true);
              if(!tight)parent.append(node);break;
            }
            case 'blockquote': {const node=element('blockquote');blocks(node,token.tokens,depth+1);parent.append(node);break;}
            case 'code': {
              const node=element('pre'),code=element('code');appendText(code,token.text);node.append(code);parent.append(node);break;
            }
            case 'hr':parent.append(element('hr'));break;
            case 'list': {
              const node=element(token.ordered?'ol':'ul'),start=Number(token.start);
              if(token.ordered&&Number.isInteger(start)&&start!==1&&start>=0&&start<=999999999)node.setAttribute('start',String(start));
              for(const [index,item] of (token.items||[]).entries()) {
                budget(depth+1,true);
                if(index)appendText(node,'\n');
                const li=element('li');blocks(li,item.tokens,depth+1,!item.loose);node.append(li);
              }
              parent.append(node);break;
            }
            case 'table': {
              const table=element('table'),head=element('thead'),body=element('tbody');
              const row=(cells,header)=>{
                const tr=element('tr');
                for(const [index,cell] of (cells||[]).entries()) {
                  budget(depth+1,true);
                  const td=element(header?'th':'td'),align=cell.align??token.align?.[index];
                  if(header)td.setAttribute('scope','col');
                  if(['left','center','right'].includes(align))td.className='md-align-'+align;
                  inline(td,cell.tokens,depth+1);tr.append(td);
                }
                return tr;
              };
              head.append(row(token.header,true));
              for(const cells of token.rows||[])body.append(row(cells,false));
              table.append(head,body);parent.append(table);break;
            }
            case 'html':case 'image':appendText(parent,token.raw);break;
            case 'checkbox':appendText(parent,token.checked?'[x] ':'[ ] ');break;
            default:appendText(parent,token.raw??token.text);
          }
        }
      }
      const staging=element('div');
      blocks(staging,lexer.lexer(value));
      target.replaceChildren(...staging.childNodes);
    } catch {
      // A malformed or excessively nested streamed chunk remains readable,
      // and never invokes Marked's HTML renderer as a fallback.
      target.textContent=value;
    }
  }

  return Object.freeze({render,LIMITS});
});
