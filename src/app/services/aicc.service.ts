import { Injectable } from '@angular/core';
import JSZip from 'jszip';

export interface AiccCourse {
  courseId: string;
  title: string;
  description: string;
  creator: string;
  version: string;
  level: string;
  assignableUnits: AssignableUnit[];
  fileName: string;
}

export interface AssignableUnit {
  systemId: string;
  commandLine: string;
  launchUrl: string;
  masteryScore: string;
  webLaunch: string;
  title: string;
  description: string;
}

@Injectable({ providedIn: 'root' })
export class AiccService {
  async parseZip(file: File): Promise<AiccCourse> {
    const zip = await JSZip.loadAsync(file);

    const crsFile = this.findFile(zip, '.crs');
    const auFile = this.findFile(zip, '.au');
    const desFile = this.findFile(zip, '.des');

    if (!crsFile || !auFile) {
      throw new Error('Invalid AICC package: missing .crs or .au file');
    }

    const crsContent = await crsFile.async('text');
    const auContent = await auFile.async('text');
    const desContent = desFile ? await desFile.async('text') : '';

    const course = this.parseCrs(crsContent);
    course.assignableUnits = this.parseAu(auContent, desContent);
    course.fileName = file.name;

    return course;
  }

  private findFile(zip: JSZip, extension: string): JSZip.JSZipObject | null {
    let found: JSZip.JSZipObject | null = null;
    zip.forEach((path, entry) => {
      if (!entry.dir && path.toLowerCase().endsWith(extension)) {
        found = entry;
      }
    });
    return found;
  }

  private parseCrs(content: string): AiccCourse {
    const lines = content.split('\n').map(l => l.trim());
    const getValue = (key: string): string => {
      const line = lines.find(l => l.toLowerCase().startsWith(key.toLowerCase() + '='));
      return line ? line.substring(key.length + 1).trim() : '';
    };

    return {
      courseId: getValue('Course_ID'),
      title: getValue('Course_Title'),
      description: this.extractDescription(content),
      creator: getValue('Course_Creator'),
      version: getValue('Version'),
      level: getValue('Level'),
      assignableUnits: [],
      fileName: '',
    };
  }

  private extractDescription(content: string): string {
    const descStart = content.indexOf('[Course_Description]');
    if (descStart === -1) return '';
    return content.substring(descStart + '[Course_Description]'.length).trim();
  }

  private parseAu(auContent: string, desContent: string): AssignableUnit[] {
    const auLines = auContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (auLines.length < 2) return [];

    const auHeaders = this.parseCsvLine(auLines[0]);
    const units: AssignableUnit[] = [];

    // Parse descriptor for titles/descriptions
    const desMap = this.parseDesFile(desContent);

    for (let i = 1; i < auLines.length; i++) {
      const values = this.parseCsvLine(auLines[i]);
      const getField = (name: string): string => {
        const idx = auHeaders.findIndex(h => h.toLowerCase() === name.toLowerCase());
        return idx >= 0 && idx < values.length ? values[idx] : '';
      };

      const systemId = getField('System_ID');
      const des = desMap.get(systemId.toLowerCase());

      units.push({
        systemId,
        commandLine: getField('command_line'),
        launchUrl: getField('File_name'),
        masteryScore: getField('Mastery_Score'),
        webLaunch: getField('Web_Launch'),
        title: des?.title || '',
        description: des?.description || '',
      });
    }

    return units;
  }

  private parseDesFile(content: string): Map<string, { title: string; description: string }> {
    const map = new Map<string, { title: string; description: string }>();
    if (!content) return map;

    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return map;

    const headers = this.parseCsvLine(lines[0]);

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i]);
      const getField = (name: string): string => {
        const idx = headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
        return idx >= 0 && idx < values.length ? values[idx] : '';
      };

      const systemId = getField('System_ID').toLowerCase();
      map.set(systemId, {
        title: getField('Title'),
        description: getField('Description'),
      });
    }

    return map;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  buildLaunchUrl(au: AssignableUnit, sessionId: string): string {
    const baseUrl = au.launchUrl;
    const hacpUrl = `${window.location.origin}/api/hacp`;
    const params = au.webLaunch
      ? `${au.webLaunch}&AICC_SID=${sessionId}&aicc_url=${encodeURIComponent(hacpUrl)}`
      : `AICC_SID=${sessionId}&aicc_url=${encodeURIComponent(hacpUrl)}`;
    return `${baseUrl}?${params}`;
  }

  async createSession(courseId: string): Promise<string> {
    const response = await fetch('/api/hacp/create-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId,
        studentId: 'student_001',
        studentName: 'Test Student',
      }),
    });
    const data = await response.json();
    return data.sessionId;
  }
}
