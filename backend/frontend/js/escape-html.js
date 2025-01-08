function escapeHtml(html) {
    let text = document.createTextNode(html);
    let p = document.createElement('p');
    p.appendChild(text);
    return p.innerHTML;
}