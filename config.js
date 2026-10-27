/* ============================================================
   云端配置
   这两个值会随网页一起公开，这是设计如此：
   anon / publishable key 只能「往表里追加」数据，读不到任何内容。
   真正能看数据的是报告口令（在 Supabase 的 report_rows 函数里）。

   换项目或换 key 时，只改这个文件，然后运行 bash deploy.sh 即可。
   ============================================================ */
window.CLOUD = {
  url: 'https://gtzarwdiungzqtcodppw.supabase.co',
  key: 'sb_publishable_ijRDN_zYTfzU_Vc4PILVMQ_JmThduGl'
};
