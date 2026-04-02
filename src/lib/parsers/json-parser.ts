export function parseJSON(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);
        // Ensure it's an array of objects
        const data = Array.isArray(parsed) ? parsed : [parsed];
        resolve(JSON.stringify(data));
      } catch (err) {
        reject(new Error(`Invalid JSON: ${err}`));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}
