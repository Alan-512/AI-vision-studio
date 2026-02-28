// Paste this in DevTools console to check the assets
const r = indexedDB.open("LuminaDB");
r.onsuccess = (e) => {
    const db = e.target.result;
    const t = db.transaction("assets", "readonly");
    const req = t.objectStore("assets").getAll();
    req.onsuccess = (ev) => {
        const items = ev.target.result;
        items.sort((a,b)=>b.createdAt-a.createdAt);
        console.log("Latest asset DB entry:", items[0]);
    }
}
