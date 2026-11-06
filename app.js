(function () {
  'use strict';
  const fr = document.documentElement.lang === 'fr';
  const names = ['resources','journal','goals','reminders','support','guides','data','about'];
  const links = Array.from(document.querySelectorAll('[data-section]'));
  const sections = names.map(name => document.getElementById('p-'+name)).filter(Boolean);
  const normal = s => s.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  document.documentElement.classList.add('js');
  function route(focus) {
    const name = names.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'resources';
    sections.forEach(section => { section.hidden = section.id !== 'p-'+name; });
    links.forEach(link => {
      const selected = link.dataset.section === name;
      if (selected) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
    if (focus) {
      const heading = document.querySelector('#p-'+name+' h2');
      if (heading) { heading.setAttribute('tabindex','-1'); heading.focus({preventScroll:true}); }
      window.scrollTo({top:0,behavior:'instant'});
    }
    document.getElementById('languageSwitch').href = (fr?'index.html':'fr.html')+'#'+name;
  }
  window.addEventListener('hashchange',() => route(true));
  route(false);
  document.getElementById('quickExit').addEventListener('click',event => {
    event.preventDefault();
    document.documentElement.style.visibility='hidden';
    try { if (window.Personal) window.Personal.lock(); }
    finally { location.replace('https://www.google.ca/'); }
  });
  // Leave the page even if JavaScript is partly unavailable; quick exit is no history eraser.
  document.getElementById('themeBtn').addEventListener('click',() => {
    const root=document.documentElement;
    const dark=root.dataset.theme ? root.dataset.theme==='dark' : matchMedia('(prefers-color-scheme:dark)').matches;
    root.dataset.theme=dark?'light':'dark';
  });
  const cards = Array.from(document.querySelectorAll('#resGrid > .res'));
  const region=document.getElementById('region'),search=document.getElementById('search');
  let category='all';
  const corpus = new Map(cards.map(c => [c,normal(c.querySelector('h3').textContent+' '+c.querySelector('p').textContent)]));
  function filter() {
    const query=normal(search.value.trim());
    let count=0;
    cards.forEach(card => {
      const show=(region.value==='ALL'||card.dataset.region==='CA'||card.dataset.region===region.value) && (category==='all'||card.dataset.category===category) && corpus.get(card).includes(query);
      card.hidden=!show;
      if (show) count++;
    });
    document.getElementById('resultCount').textContent=fr?`${count} ressources affichées`:`${count} resources shown`;
    document.getElementById('noResults').hidden=count!==0;
  }
  document.querySelectorAll('#chips button').forEach(button => button.addEventListener('click',() => {
    category=button.dataset.category;
    document.querySelectorAll('#chips button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    filter();
  }));
  region.addEventListener('change',filter);
  search.addEventListener('input',filter);
  filter();
  if (window.Personal) Promise.resolve(window.Personal.init({lang:fr?'fr':'en'})).catch(() => {
    const message=document.createElement('p'); message.className='note field-error';
    message.textContent=fr?'Les outils personnels n’ont pas démarré. Les ressources et le soutien restent accessibles.':'Personal tools could not start. Resources and support are still available.';
    document.getElementById('main').prepend(message);
  });
})();
