try {
  const PQueue = require("p-queue");
  console.log("p-queue is importable via require");
} catch (e) {
  console.log("p-queue failed to require:", e.message);
  try {
     import("p-queue").then(m => {
       console.log("p-queue is importable via dynamic import");
     }).catch(err => {
       console.log("p-queue dynamic import failed:", err.message);
     });
  } catch (e2) {
     console.log("p-queue dynamic import exception:", e2.message);
  }
}
