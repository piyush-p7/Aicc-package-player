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
  embeddedUrl = signal<SafeResourceUrl | null>(null);

  constructor(private aiccService: AiccService, private sanitizer: DomSanitizer) {}

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
  }

  async launchUnit(au: AssignableUnit) {
    const course = this.activeCourse();
    if (!course) return;

    const sessionId = await this.aiccService.createSession(course.courseId);
    const url = this.aiccService.buildLaunchUrl(au, sessionId);

    if (this.openInNewWindow()) {
      const width = 1024;
      const height = 768;
      const left = (screen.width - width) / 2;
      const top = (screen.height - height) / 2;
      window.open(url, '_blank', `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`);
    } else {
      this.embeddedUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
    }
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
