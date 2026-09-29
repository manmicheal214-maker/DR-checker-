const apiBase="https://bulk-dr-checker.manmicheal214.workers.dev";
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const input=$("singleAuditUrl"),run=$("singleAuditRun"),clear=$("singleAuditClear"),loading=$("singleAuditLoading"),error=$("singleAuditError"),errorText=$("singleAuditErrorText"),results=$("singleAuditResults");
async function post(path,body){const r=await fetch(apiBase+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(r.status===429)throw new Error(d.error||"Hourly limit reached.");if(!r.ok||d.success===false)throw new Error(d.error||path+" failed.");return d}
function metric(label,value,detail=""){return '<div class="audit-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(detail)+'</small></div>'}
run.addEventListener("click",async()=>{error.classList.add("hidden");results.classList.add("hidden");const url=input.value.trim();if(!url)return showError("Enter a page URL.");try{new URL(url);if(!/^https?:/i.test(url))return showError("Use an http or https URL.");}catch{return showError("Enter a valid http or https URL.");}loading.classList.remove("hidden");run.disabled=true;try{
 const tasks=await Promise.all([
  (async()=>{try{return{data:await post("/check-meta",{urls:[url]}),error:null}}catch(e){return{data:null,error:e.message}}})(),
  (async()=>{try{return{data:await post("/check-headers",{urls:[url]}),error:null}}catch(e){return{data:null,error:e.message}}})(),
  (async()=>{try{return{data:await post("/check-status",{urls:[url]}),error:null}}catch(e){return{data:null,error:e.message}}})(),
  (async()=>{try{return{data:await post("/check-links",{url}),error:null}}catch(e){return{data:null,error:e.message}}})()
 ]);
 const [metaR,headersR,statusR,linksR]=tasks;const meta=metaR.data?.results?.[0],headers=headersR.data?.results?.[0],status=statusR.data?.results?.[0],links=linksR.data;
 const issues=[];
 if(metaR.error)issues.push("Metadata check failed: "+metaR.error);else if(meta?.error)issues.push("Metadata: "+meta.error);else{if(!meta?.title)issues.push("Page title is missing.");else if(meta.title.length>60)issues.push("Page title exceeds 60 characters.");if(!meta?.description)issues.push("Meta description is missing.");else if(meta.description.length>160)issues.push("Meta description exceeds 160 characters.");if(meta?.h1_count===0)issues.push("No H1 heading found.");else if(meta?.h1_count>1)issues.push("Multiple H1 headings found.");if(!meta?.canonical)issues.push("Canonical tag is missing.");}
 if(headersR.error)issues.push("Security headers check failed: "+headersR.error);else if(headers?.error)issues.push("Security headers: "+headers.error);else if(headers?.score<6)issues.push((6-headers.score)+" checked security header(s) missing.");
 if(statusR.error)issues.push("Reachability check failed: "+statusR.error);else if(status&&!status.ok)issues.push("Page could not be reached: "+(status.error||"request failed"));else if(status?.final_status>=400)issues.push("Page returned HTTP "+status.final_status+".");
 if(linksR.error)issues.push("Broken-link check failed: "+linksR.error);else if(links?.results){const broken=links.results.filter(x=>!x.ok&&!x.skipped).length;if(broken)issues.push(broken+" checked link(s) failed.");}
 $("singleAuditContext").textContent=url;
 $("singleAuditSummary").innerHTML=metric("Title length",metaR.error||meta?.error?"N/A":(meta?.title?.length??0),"characters")+metric("Description length",metaR.error||meta?.error?"N/A":(meta?.description?.length??0),"characters")+metric("H1 count",metaR.error||meta?.error?"N/A":(meta?.h1_count??"N/A"),"headings")+metric("Security headers",headersR.error||headers?.error?"N/A":((headers?.score??"N/A")+"/6"),"present")+metric("HTTP status",statusR.error?"N/A":(status?.final_status??"N/A"),status?.ok?"Request completed":"Check reachability")+metric("Canonical",metaR.error||meta?.error?"N/A":(meta?.canonical?"Present":"Missing"),"link rel=canonical");
 $("singleAuditIssueCount").textContent=issues.length+" individually identified issue(s); no composite score is calculated.";
 $("singleAuditIssues").innerHTML=issues.length?issues.map(x=>"<li>"+esc(x)+"</li>").join(""):"<li>No issues were identified by the checks that completed.</li>";
 const labels=[["csp","Content-Security-Policy"],["hsts","Strict-Transport-Security"],["x_content_type_options","X-Content-Type-Options"],["x_frame_options","X-Frame-Options"],["referrer_policy","Referrer-Policy"],["permissions_policy","Permissions-Policy"]];
 $("singleAuditHeaders").innerHTML=headersR.error?("<p>"+esc(headersR.error)+"</p>"):headers?.error?("<p>"+esc(headers.error)+"</p>"):"<ul>"+labels.map(([k,l])=>"<li><strong>"+esc(l)+":</strong> "+esc(headers?.headers?.[k]||"Not present")+"</li>").join("")+"</ul>";
 $("singleAuditLinks").innerHTML=linksR.error?("<p>"+esc(linksR.error)+"</p>"):links?.error?("<p>"+esc(links.error)+"</p>"):links?.results?"<p>"+esc(links.checked_count)+" of "+esc(links.total_links_found)+" links checked.</p><ul>"+links.results.map(x=>"<li>"+esc(x.url)+" — "+esc(x.ok?"OK":x.skipped?"Skipped":(x.final_status??x.error??"Failed"))+"</li>").join("")+"</ul>":"<p>No link results returned.</p>";
 results.classList.remove("hidden");
 }catch(e){showError(e.message||"Audit failed.")}finally{loading.classList.add("hidden");run.disabled=false}});
function showError(message){errorText.textContent=message;error.classList.remove("hidden")}
clear.addEventListener("click",()=>{input.value="";error.classList.add("hidden");results.classList.add("hidden");input.focus()});
