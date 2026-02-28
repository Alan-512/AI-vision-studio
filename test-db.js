// Paste this in DevTools console to check IndexedDB
const r = indexedDB.open("LuminaDB");
r.onsuccess = (e) => {
    const db = e.target.result;
    const t = db.transaction("assets", "readonly");
    const req = t.objectStore("assets").getAll();
    req.onsuccess = (ev) => {
        const items = ev.target.result;
        console.log("Total assets in DB:", items.length);
        console.log("Recent assets:", items.sort((a,b)=>b.createdAt-a.createdAt).slice(0,5));
    }
}
