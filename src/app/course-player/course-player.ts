import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AiccService, AiccCourse, AssignableUnit } from '../services/aicc.service';

@Component({
  selector: 'app-course-player',
  imports: [CommonModule],
  templateUrl: './course-player.html',
  styleUrl: './course-player.scss'
})
export class CoursePlayerComponent {
  courses = signal<AiccCourse[]>([]);
  error = signal<string | null>(null);
  isDragging = signal(false);
  activeCourse = signal<AiccCourse | null>(null);
  openInNewWindow = signal(true);
  cornerstoneMode = signal(false);
  embeddedUrl = signal<SafeResourceUrl | null>(null);

  constructor(private aiccService: AiccService, private sanitizer: DomSanitizer) {
    window.addEventListener('message', (event) => {
      if (event.data === 'close-cornerstone') {
        this.closeEmbedded();
      }
    });
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  async onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    const files = event.dataTransfer?.files;
    if (files) {
      await this.processFiles(files);
    }
  }

  async onFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      await this.processFiles(input.files);
      input.value = '';
    }
  }

  private async processFiles(files: FileList) {
    this.error.set(null);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.toLowerCase().endsWith('.zip')) {
        this.error.set(`"${file.name}" is not a ZIP file. Please upload AICC course ZIP packages.`);
        continue;
      }

      try {
        const course = await this.aiccService.parseZip(file);
        this.courses.update(list => [...list, course]);
      } catch (e: any) {
        this.error.set(e.message || 'Failed to parse course package.');
      }
    }
  }

  viewCourse(course: AiccCourse) {
    this.activeCourse.set(course);
  }

  backToList() {
    this.activeCourse.set(null);
  }

  toggleOpenMode() {
    this.openInNewWindow.update(v => !v);
    if (!this.openInNewWindow()) {
      // If switching to embedded, keep cornerstone mode as is
    }
  }

  toggleCornerstoneMode() {
    this.cornerstoneMode.update(v => !v);
    if (this.cornerstoneMode()) {
      this.openInNewWindow.set(false);
    }
  }

  async launchUnit(au: AssignableUnit) {
    const course = this.activeCourse();
    if (!course) return;

    const sessionId = await this.aiccService.createSession(course.courseId);
    const url = this.aiccService.buildLaunchUrl(au, sessionId);

    if (this.openInNewWindow() && !this.cornerstoneMode()) {
      const width = 1024;
      const height = 768;
      const left = (screen.width - width) / 2;
      const top = (screen.height - height) / 2;
      window.open(url, '_blank', `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`);
    } else if (this.cornerstoneMode()) {
      // Simulate Cornerstone: create a blob URL that acts as an intermediate
      // cross-origin-like frame, embedding the AICC URL in a nested iframe
      const cornerstoneHtml = this.buildCornerstonePlayerHtml(url);
      const blob = new Blob([cornerstoneHtml], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      this.embeddedUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl));
    } else {
      this.embeddedUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
    }
  }

  /**
   * Builds HTML that simulates Cornerstone's LMS player structure:
   * Outer page (simulating csod.com) → iframe (the AICC content)
   * This replicates the nested iframe context that causes third-party cookie issues.
   */
  private buildCornerstonePlayerHtml(launchUrl: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Cornerstone LMS Simulation - Training Player</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f5f5f5; }
    .csod-header {
      background: #1a237e;
      color: white;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 14px;
    }
    .csod-header .logo { font-weight: 700; font-size: 16px; }
    .csod-header .nav { display: flex; gap: 16px; }
    .csod-header .nav a { color: rgba(255,255,255,0.8); text-decoration: none; }
    .csod-toolbar {
      background: white;
      border-bottom: 1px solid #e0e0e0;
      padding: 8px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .csod-toolbar .title { font-weight: 600; color: #333; font-size: 15px; }
    .csod-toolbar .exit-btn {
      background: #d32f2f;
      color: white;
      border: none;
      padding: 6px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    .csod-player {
      width: 100%;
      height: calc(100vh - 90px);
      border: none;
    }
    .csod-banner {
      background: #fff3cd;
      border-bottom: 1px solid #ffc107;
      padding: 6px 24px;
      font-size: 12px;
      color: #856404;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="csod-header">
    <span class="logo">⬡ Cornerstone (Simulated)</span>
    <div class="nav">
      <a href="#">Home</a>
      <a href="#">Training</a>
      <a href="#">Reports</a>
    </div>
  </div>
  <div class="csod-banner">
    ⚠️ This is a simulation of Cornerstone's iframe-based player. The course below is loaded inside a nested iframe to replicate the cross-origin cookie blocking behavior.
  </div>
  <div class="csod-toolbar">
    <span class="title">Training Player</span>
    <button class="exit-btn" onclick="window.parent.postMessage('close-cornerstone','*')">Exit Course</button>
  </div>
  <iframe class="csod-player" src="${launchUrl}" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation"></iframe>
</body>
</html>`;
  }

  closeEmbedded() {
    this.embeddedUrl.set(null);
  }

  removeCourse(course: AiccCourse) {
    this.courses.update(list => list.filter(c => c !== course));
    if (this.activeCourse() === course) {
      this.activeCourse.set(null);
    }
  }
}
