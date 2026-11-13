import json, os, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
repo=Path(__file__).resolve().parents[2]
root=Path(tempfile.mkdtemp(prefix='logistics-usage-browser-'))
(root/'browser-usage.json').write_text('{}')
log=open(root/'log-browser-server.log','w')
server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','18763','--config','tests/browser/usage.config.mjs'],cwd=repo,stdout=log,stderr=log,env={**os.environ,'USAGE_FIXTURE_PATH':str(root/'browser-usage.json')})
try:
 for _ in range(100):
  try:urllib.request.urlopen('http://127.0.0.1:18763',timeout=1);break
  except Exception:time.sleep(.1)
 else:raise RuntimeError('Server did not start')
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROME_PATH','/usr/bin/google-chrome'),args=['--no-sandbox'])
  results=[]
  for index,invalid in enumerate([-1,-10,1.5,'12',None,9007199254740992]):
   for field in ['prompt_tokens','completion_tokens']:
    context=browser.new_context(viewport={'width':1440,'height':1100}, reduced_motion='reduce')
    page=context.new_page()
    page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(('http://127.0.0.1:18763','ws://127.0.0.1:18763')) else route.abort())
    usage={'prompt_tokens':7,'completion_tokens':8,field:invalid}
    (root/'browser-usage.json').write_text(json.dumps(usage))
    page.goto('http://127.0.0.1:18763')
    page.locator('#submit-request').wait_for(state='visible')
    page.wait_for_function('!document.querySelector("#submit-request").disabled')
    item=f'Browser fixture {index} {field}'
    page.locator('#item').fill(item)
    page.locator('#deadline').fill('2026-11-20')
    with page.expect_response('**/api/procurement/estimates') as response:
     page.locator('#submit-request').click()
    data=response.value.json()
    assert response.value.status==200,data
    assert data['provenance']['usage'][('inputTokens' if field=='prompt_tokens' else 'outputTokens')] is None,data
    page.locator('#compare').wait_for(state='visible')
    page.locator('#compare').click()
    page.get_by_text('A clear choice.',exact=True).wait_for()
    assert page.locator('.winner-banner').is_visible()
    results.append({'usage':usage,'normalized':data['provenance']['usage'],'winner':page.locator('.winner-banner h3').inner_text()})
    if len(results)==1:
     page.wait_for_function('document.getAnimations().every(a => a.playState === "finished")')
     page.screenshot(path=str(root/'comparison.png'),full_page=True)
    context.close()
  browser.close()
 (root/'log-browser-results.json').write_text(json.dumps(results,indent=2))
 print('Browser normal UI estimate+comparison cases passed:',len(results))
 print('Evidence:',root)
finally:
 server.terminate()
 try:server.wait(timeout=10)
 except subprocess.TimeoutExpired:server.kill();server.wait()
 log.close()
