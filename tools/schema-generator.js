const typeEl=document.getElementById("schemaType");
const fieldsEl=document.getElementById("schemaFields");
const outputEl=document.getElementById("schemaOutput");
const statusEl=document.getElementById("schemaStatus");
const generateBtn=document.getElementById("generateSchema");
const copyBtn=document.getElementById("copySchema");

const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const val=id=>document.getElementById(id)?.value.trim()||"";
const field=(label,id,type="text",placeholder="",extra="")=>'<label class="schema-field"><span>'+esc(label)+'</span><input id="'+esc(id)+'" type="'+type+'" placeholder="'+esc(placeholder)+'" '+extra+'></label>';
const area=(label,id,placeholder="")=>'<label class="schema-field"><span>'+esc(label)+'</span><textarea id="'+esc(id)+'" placeholder="'+esc(placeholder)+'"></textarea></label>';

function renderFields(){
 const type=typeEl.value;
 let html="";
 if(type==="Article") html=field("Headline","headline")+area("Description","description")+field("Image URL","image","url")+field("Author name","authorName")+field("Publisher name","publisherName")+field("Publisher logo URL","publisherLogo","url")+field("Date published","datePublished","date")+field("Date modified (optional)","dateModified","date");
 if(type==="FAQPage") html='<div id="faqItems" class="repeat-list"></div><button id="addFaq" class="btn btn-secondary" type="button">Add question</button>';
 if(type==="Product") html=field("Name","productName")+field("Image URL","productImage","url")+area("Description","productDescription")+field("Brand name","brandName")+field("Price","price","number","19.99",'step="any" min="0"')+'<label class="schema-field"><span>Currency</span><select id="currency"><option>USD</option><option>EUR</option><option>GBP</option><option>AUD</option><option>CAD</option><option>JPY</option><option>INR</option></select></label><label class="schema-field"><span>Availability</span><select id="availability"><option value="https://schema.org/InStock">In stock</option><option value="https://schema.org/OutOfStock">Out of stock</option><option value="https://schema.org/PreOrder">Pre-order</option></select></label>'+field("Product page URL","productUrl","url")+field("Rating value (optional)","ratingValue","number","4.8",'step="any" min="0"')+field("Review count (optional)","reviewCount","number","125",'step="1" min="1"');
 if(type==="HowTo") html=field("Name","howtoName")+area("Description","howtoDescription")+'<div class="duration-grid">'+field("Hours","durationHours","number","0",'min="0" step="1"')+field("Minutes","durationMinutes","number","30",'min="0" max="59" step="1"')+'</div><div id="howtoSteps" class="repeat-list"></div><button id="addStep" class="btn btn-secondary" type="button">Add step</button>';
 if(type==="LocalBusiness") html=field("Name","businessName")+field("Image URL","businessImage","url")+field("Street address","streetAddress")+field("City","addressLocality")+field("Region","addressRegion")+field("Postal code","postalCode")+field("Country","addressCountry")+field("Telephone","telephone","tel")+field("Price range","priceRange","text","$$")+'<div id="hoursItems" class="repeat-list"></div><button id="addHours" class="btn btn-secondary" type="button">Add opening hours</button>';
 if(type==="BreadcrumbList") html='<div id="crumbItems" class="repeat-list"></div><button id="addCrumb" class="btn btn-secondary" type="button">Add breadcrumb</button>';
 fieldsEl.innerHTML=html;
 if(type==="FAQPage"){document.getElementById("addFaq").onclick=()=>addFaq();}
 if(type==="HowTo"){document.getElementById("addStep").onclick=()=>addStep();}
 if(type==="LocalBusiness"){document.getElementById("addHours").onclick=()=>addHours();}
 if(type==="BreadcrumbList"){document.getElementById("addCrumb").onclick=()=>addCrumb();}
 if(type==="FAQPage") addFaq();
 if(type==="HowTo") addStep();
 if(type==="LocalBusiness") addHours();
 if(type==="BreadcrumbList") addCrumb();
 statusEl.textContent="";
 outputEl.value="";
 copyBtn.disabled=true;
}
function removeRow(btn){btn.closest(".repeat-row").remove();}
function addFaq(){
 const wrap=document.getElementById("faqItems"),row=document.createElement("div");row.className="repeat-row";
 row.innerHTML=area("Question","faqName","Question")+area("Answer","faqAnswer","Answer text")+'<button class="btn btn-secondary remove-row" type="button">Remove</button>';
 row.querySelector(".remove-row").onclick=()=>removeRow(row.querySelector(".remove-row"));wrap.appendChild(row);
}
function addStep(){
 const wrap=document.getElementById("howtoSteps"),row=document.createElement("div");row.className="repeat-row";
 row.innerHTML=field("Step name","stepName","text","Step name")+area("Step text","stepText","What to do")+ '<button class="btn btn-secondary remove-row" type="button">Remove</button>';
 row.querySelector(".remove-row").onclick=()=>removeRow(row.querySelector(".remove-row"));wrap.appendChild(row);
}
function addHours(){
 const wrap=document.getElementById("hoursItems"),row=document.createElement("div");row.className="repeat-row";
 row.innerHTML=field("Opening hours","hoursEntry","text","Mo-Fr 09:00-17:00")+'<button class="btn btn-secondary remove-row" type="button">Remove</button>';
 row.querySelector(".remove-row").onclick=()=>removeRow(row.querySelector(".remove-row"));wrap.appendChild(row);
}
function addCrumb(){
 const wrap=document.getElementById("crumbItems"),row=document.createElement("div");row.className="repeat-row";
 row.innerHTML=field("Name","crumbName","text","Home")+field("URL","crumbUrl","url","https://example.com/")+ '<button class="btn btn-secondary remove-row" type="button">Remove</button>';
 row.querySelector(".remove-row").onclick=()=>removeRow(row.querySelector(".remove-row"));wrap.appendChild(row);
}
function nonempty(obj,key,value){if(value)obj[key]=value;}
function buildObject(){
 const type=typeEl.value,obj={"@context":"https://schema.org","@type":type};
 if(type==="Article"){nonempty(obj,"headline",val("headline"));nonempty(obj,"description",val("description"));nonempty(obj,"image",val("image"));const author={ "@type":"Person" };nonempty(author,"name",val("authorName"));if(Object.keys(author).length>1)obj.author=author;const publisher={"@type":"Organization"};nonempty(publisher,"name",val("publisherName"));const logo={"@type":"ImageObject"};nonempty(logo,"url",val("publisherLogo"));if(Object.keys(logo).length>1)publisher.logo=logo;if(Object.keys(publisher).length>1)obj.publisher=publisher;nonempty(obj,"datePublished",val("datePublished"));nonempty(obj,"dateModified",val("dateModified"));}
 if(type==="FAQPage")obj.mainEntity=[...document.querySelectorAll("#faqItems .repeat-row")].map(row=>{const q=row.querySelector('textarea[id="faqName"]')?.value.trim()||"",a=row.querySelector('textarea[id="faqAnswer"]')?.value.trim()||"";const answer={"@type":"Answer"};nonempty(answer,"text",a);const question={"@type":"Question"};nonempty(question,"name",q);if(Object.keys(answer).length>1)question.acceptedAnswer=answer;return question;});
 if(type==="Product"){nonempty(obj,"name",val("productName"));nonempty(obj,"image",val("productImage"));nonempty(obj,"description",val("productDescription"));const brand={"@type":"Brand"};nonempty(brand,"name",val("brandName"));if(Object.keys(brand).length>1)obj.brand=brand;const offer={"@type":"Offer"};nonempty(offer,"price",val("price"));nonempty(offer,"priceCurrency",val("currency"));nonempty(offer,"availability",val("availability"));nonempty(offer,"url",val("productUrl"));obj.offers=offer;const rv=val("ratingValue"),rc=val("reviewCount");if(rv&&rc)obj.aggregateRating={"@type":"AggregateRating","ratingValue":rv,"reviewCount":rc};}
 if(type==="HowTo"){nonempty(obj,"name",val("howtoName"));nonempty(obj,"description",val("howtoDescription"));const h=Number(val("durationHours")||0),m=Number(val("durationMinutes")||0);if(h||m)obj.totalTime="PT"+(h?h+"H":"")+(m?m+"M":"");obj.step=[...document.querySelectorAll("#howtoSteps .repeat-row")].map(row=>{const s={"@type":"HowToStep"};nonempty(s,"name",row.querySelector('input[id="stepName"]')?.value.trim()||"");nonempty(s,"text",row.querySelector('textarea[id="stepText"]')?.value.trim()||"");return s;});}
 if(type==="LocalBusiness"){nonempty(obj,"name",val("businessName"));nonempty(obj,"image",val("businessImage"));const a={"@type":"PostalAddress"};nonempty(a,"streetAddress",val("streetAddress"));nonempty(a,"addressLocality",val("addressLocality"));nonempty(a,"addressRegion",val("addressRegion"));nonempty(a,"postalCode",val("postalCode"));nonempty(a,"addressCountry",val("addressCountry"));obj.address=a;nonempty(obj,"telephone",val("telephone"));nonempty(obj,"priceRange",val("priceRange"));obj.openingHours=[...document.querySelectorAll("#hoursItems input")].map(x=>x.value.trim()).filter(Boolean);}
 if(type==="BreadcrumbList")obj.itemListElement=[...document.querySelectorAll("#crumbItems .repeat-row")].map((row,i)=>{const x={"@type":"ListItem","position":i+1};nonempty(x,"name",row.querySelector('input[id="crumbName"]')?.value.trim()||"");nonempty(x,"item",row.querySelector('input[id="crumbUrl"]')?.value.trim()||"");return x;});
 return obj;
}
function generate(){
 try{const obj=buildObject();const json=JSON.stringify(obj,null,2);JSON.parse(json);const wrapped='<script type="application/ld+json">\n'+json+'\n</script>';outputEl.value=wrapped;copyBtn.disabled=false;statusEl.textContent="✓ JSON generated and round-trip JSON.parse() succeeded.";statusEl.className="tool-note success-note";}catch(e){outputEl.value="";copyBtn.disabled=true;statusEl.textContent="Generation error: "+e.message;statusEl.className="tool-note error-note";}}
async function copyOutput(){try{await navigator.clipboard.writeText(outputEl.value);statusEl.textContent="✓ Copied to clipboard.";}catch(e){outputEl.select();document.execCommand("copy");statusEl.textContent="✓ Copied to clipboard.";}}
typeEl.addEventListener("change",renderFields);generateBtn.addEventListener("click",generate);copyBtn.addEventListener("click",copyOutput);renderFields();