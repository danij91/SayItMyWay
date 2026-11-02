// Operate the visible replacement; retain the select only for reading values.
export async function chooseLanguage(page,selector,value,query){
  const select=page.locator(selector),inputId=await select.evaluate(el=>el.languagePicker.input.id);
  const input=page.locator('#'+inputId);
  if(!await input.isVisible()){
    if(await page.locator('#language-open').count())await page.locator('#language-open').click();
    else await page.locator('#editor-language summary').click();
  }
  const label=await select.evaluate((el,value)=>[...el.options].find(o=>o.value===value)?.textContent,value);
  await input.fill(query??label);
  const list=page.locator('#'+await input.getAttribute('aria-controls'));
  // Exact value disambiguates languages sharing a country or label fragment.
  await list.locator('[role=option][data-value='+JSON.stringify(value)+']').click();
}
