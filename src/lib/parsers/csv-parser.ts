import Papa from "papaparse";

export function parseCSV(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      // Validate it's parseable CSV
      const result = Papa.parse(text, { header: true, preview: 2 });
      if (result.errors.length > 0 && result.data.length === 0) {
        reject(new Error("Invalid CSV file"));
        return;
      }
      resolve(text);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

export function parseCSVFromText(text: string): Record<string, unknown>[] {
  const result = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
  return result.data as Record<string, unknown>[];
}
