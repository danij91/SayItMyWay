const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const editorURL=new URL('editor/index.html',location.href);
editorURL.searchParams.set('embedded','1');
if(params.get('table'))editorURL.searchParams.set('table',params.get('table'));
$('table-frame').src=editorURL.href;
