const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const inline=(s:string)=>esc(s).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1 ↗</a>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>');
/** Small escaped Markdown renderer for the local research artifact; no raw HTML. */
export function markdown(source:string):string{
 const lines=source.split('\n'),out:string[]=[];let paragraph:string[]=[],list=false,table=false,code=false;
 const flush=()=>{if(paragraph.length){out.push(`<p>${inline(paragraph.join(' '))}</p>`);paragraph=[];}};
 const close=()=>{flush();if(list){out.push('</ul>');list=false;}if(table){out.push('</tbody></table></div>');table=false;}};
 for(const line of lines){
  if(line.startsWith('```')){close();out.push(code?'</code></pre>':'<pre><code>');code=!code;continue;}
  if(code){out.push(esc(line)+'\n');continue;}
  if(/^\s*\|/.test(line)){
   flush();if(!table){out.push('<div class="table-scroll"><table><tbody>');table=true;}
   if(/^\s*\|[\s:|-]+$/.test(line))continue;
   out.push('<tr>'+line.trim().replace(/^\||\|$/g,'').split('|').map(c=>`<td>${inline(c.trim())}</td>`).join('')+'</tr>');continue;
  }else if(table){out.push('</tbody></table></div>');table=false;}
  const h=line.match(/^(#{1,6})\s+(.*)/);if(h){close();out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);continue;}
  if(/^\s*[-*]\s+|^\s*\d+\.\s+/.test(line)){flush();if(!list){out.push('<ul>');list=true;}out.push(`<li>${inline(line.replace(/^\s*(?:[-*]|\d+\.)\s+/,''))}</li>`);continue;}
  if(!line.trim()){close();continue;}
  if(/^---+$/.test(line)){close();out.push('<hr>');continue;}
  if(line.startsWith('> ')){close();out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);continue;}
  if(list){out.push('</ul>');list=false;}paragraph.push(line);
 }
 close();return out.join('\n');
}
