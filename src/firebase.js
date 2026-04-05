import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD-AJTLig_IWlqHcTXe372MLxZqepButxg",
  authDomain: "takochan-traza-fa8b0.firebaseapp.com",
  projectId: "takochan-traza-fa8b0",
  storageBucket: "takochan-traza-fa8b0.firebasestorage.app",
  messagingSenderId: "834782748476",
  appId: "1:834782748476:web:47b0ad9b6755dbb26a0839"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Enable offline persistence — app works without internet
// Data syncs automatically when connection is restored
enableIndexedDbPersistence(db).catch(err => {
  if (err.code === "failed-precondition") {
    console.warn("Offline persistence disabled: multiple tabs open");
  } else if (err.code === "unimplemented") {
    console.warn("Offline persistence not supported in this browser");
  }
});
