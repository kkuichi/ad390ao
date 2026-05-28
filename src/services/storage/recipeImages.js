// Práca s obrázkami receptov v Cloud Storage (upload, načítanie URL, mazanie).
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../../firebase';


export async function uploadRecipeImage(uid, localUri) {
  if (!uid) throw new Error('uid required');
  if (!localUri) throw new Error('localUri required');

  // 1) Stiahneme lokálny súbor ako blob – fetch v RN funguje aj s file:// URI.
  const response = await fetch(localUri);
  const blob = await response.blob();

  // 2) Vyrobíme deterministický path: recipeImages/{uid}/{timestamp}.{ext}
  //    Príponu odhadneme z blob.type alebo z URI; default jpg.
  const ext = guessExtension(blob.type, localUri);
  const filename = `${Date.now()}.${ext}`;
  const path = `recipeImages/${uid}/${filename}`;
  const storageRef = ref(storage, path);

  // 3) Upload + získanie verejnej URL.
  await uploadBytes(storageRef, blob, {
    contentType: blob.type || `image/${ext}`,
  });
  const url = await getDownloadURL(storageRef);
  return { url, path };
}

// Pokus o vymazanie predošlého obrázka pri update receptu.
// Tichý fail – ak rule nedovolí, alebo súbor neexistuje, neprerušíme uloženie receptu.

export async function tryDeleteRecipeImage(path) {
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch {
    // Ignorujeme – nechceme zhodiť celé uloženie receptu kvôli sirote v Storage.
  }
}

function guessExtension(mime, uri) {
  if (mime) {
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('heic')) return 'heic';
  }
  const m = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(uri || '');
  if (m && m[1]) return m[1].toLowerCase();
  return 'jpg';
}
