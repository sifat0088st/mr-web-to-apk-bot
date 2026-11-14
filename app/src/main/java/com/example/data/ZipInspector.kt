package com.example.data

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.zip.ZipInputStream

object ZipInspector {
  private val allowedExtensions = setOf(
    "html", "htm", "css", "js", "mjs", "json", "webmanifest", "txt", "xml", "svg",
    "png", "jpg", "jpeg", "webp", "gif", "ico", "woff", "woff2", "ttf", "otf", "eot", "map"
  )

  private val blockedExtensions = setOf(
    "php", "php3", "php4", "php5", "phtml", "phar", "sql", "sqlite", "sqlite3", "db",
    "py", "pyc", "sh", "bash", "bat", "cmd", "ps1", "exe", "dll", "so", "elf", "bin",
    "apk", "aab", "jar", "zip", "tar", "gz", "7z", "rar", "rb", "pl", "jsp", "asp", "aspx", "wasm"
  )

  private val javaKeywords = setOf(
    "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const",
    "continue", "default", "do", "double", "else", "enum", "extends", "final", "finally", "float",
    "for", "goto", "if", "implements", "import", "instanceof", "int", "interface", "long", "native",
    "new", "package", "private", "protected", "public", "return", "short", "static", "strictfp",
    "super", "switch", "synchronized", "this", "throw", "throws", "transient", "try", "void",
    "volatile", "while", "true", "false", "null"
  )

  fun scanZipStream(
    inputStream: InputStream,
    fileName: String,
    compressedSizeBytes: Long,
    maxExtractedBytes: Long = 60L * 1024L * 1024L,
    maxFileCount: Int = 500,
    maxDepthLimit: Int = 10,
  ): ZipScanReport {
    val findings = mutableListOf<String>()
    val approved = mutableListOf<String>()
    var fileCount = 0
    var totalExtracted = 0L
    var maxDepth = 0
    var hasIndexHtml = false

    ZipInputStream(inputStream).use { zis ->
      val buf = ByteArray(8192)
      while (true) {
        val entry = zis.nextEntry ?: break
        val name = entry.name

        if (name.startsWith("/") || name.startsWith("\\") || name.contains("..") || name.contains("\\")) {
          findings.add("Path traversal or absolute path blocked: $name")
          zis.closeEntry()
          continue
        }

        if (entry.isDirectory) {
          val d = name.split("/").count { it.isNotEmpty() }
          if (d > maxDepthLimit) findings.add("Directory depth ($d) exceeds limit ($maxDepthLimit): $name")
          zis.closeEntry()
          continue
        }

        fileCount++
        if (fileCount > maxFileCount) {
          findings.add("File count exceeded limit ($maxFileCount)")
          break
        }

        val depth = (name.split("/").count { it.isNotEmpty() } - 1).coerceAtLeast(0)
        if (depth > maxDepth) maxDepth = depth
        if (depth > maxDepthLimit) {
          findings.add("File depth ($depth) exceeds limit ($maxDepthLimit): $name")
        }

        val ext = name.substringAfterLast('/', name).substringAfterLast('.', "").lowercase()
        if (ext.isEmpty()) {
          findings.add("Missing file extension: $name")
        } else if (ext in blockedExtensions) {
          findings.add("Disallowed backend/executable/archive extension (.$ext): $name")
        } else if (ext !in allowedExtensions) {
          findings.add("Unapproved file extension (.$ext): $name")
        }

        val headBuf = ByteArrayOutputStream()
        var entryBytes = 0L
        while (true) {
          val read = zis.read(buf)
          if (read <= 0) break
          entryBytes += read
          totalExtracted += read
          if (headBuf.size() < 4096) {
            headBuf.write(buf, 0, minOf(read, 4096 - headBuf.size()))
          }
          if (totalExtracted > maxExtractedBytes) {
            findings.add("ZIP bomb guard: extracted size exceeded ${maxExtractedBytes / (1024 * 1024)} MB")
            break
          }
        }
        zis.closeEntry()
        if (totalExtracted > maxExtractedBytes) break

        val head = headBuf.toByteArray()
        if (head.size >= 4) {
          if (head[0] == 0x7f.toByte() && head[1] == 0x45.toByte() && head[2] == 0x4c.toByte() && head[3] == 0x46.toByte()) {
            findings.add("ELF executable binary detected in $name")
          } else if (head[0] == 0x50.toByte() && head[1] == 0x4b.toByte() && head[2] == 0x03.toByte() && head[3] == 0x04.toByte()) {
            findings.add("Nested ZIP/JAR/APK archive detected in $name")
          }
        }
        if (head.size >= 15 && String(head, 0, 15, Charsets.UTF_8).startsWith("SQLite format 3")) {
          findings.add("SQLite binary database detected in $name")
        }
        if (ext == "html" || ext == "htm" || ext == "svg") {
          val textHead = String(head, Charsets.UTF_8)
          if (Regex("^\\s*<\\?php\\b", RegexOption.IGNORE_CASE).containsMatchIn(textHead)) {
            findings.add("Server-side PHP tag detected inside $name")
          }
        }

        if (name == "index.html") {
          hasIndexHtml = true
        }
        approved.add(name)
      }
    }

    if (!hasIndexHtml) {
      findings.add("Missing required root index.html")
    }

    return ZipScanReport(
      passed = findings.isEmpty() && hasIndexHtml,
      fileName = fileName,
      compressedSizeBytes = compressedSizeBytes,
      extractedSizeBytes = totalExtracted,
      fileCount = fileCount,
      maxDepth = maxDepth,
      hasIndexHtml = hasIndexHtml,
      findings = findings,
      approvedFiles = approved.take(25),
    )
  }

  fun validateAppForm(
    appName: String,
    packageName: String,
    versionCode: String,
    statusBarHex: String,
    navBarHex: String,
  ): ConfigValidationResult {
    val errors = mutableListOf<String>()
    if (appName.trim().length !in 2..30) {
      errors.add("App name must be 2–30 characters.")
    }
    val pkg = packageName.trim().lowercase()
    if (!Regex("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$").matches(pkg)) {
      errors.add("Package name must follow Android reverse-domain format (e.g. com.mr.shop).")
    } else if (pkg.split(".").any { it in javaKeywords }) {
      errors.add("Package name contains a reserved Java keyword.")
    }
    val vc = versionCode.trim().toIntOrNull()
    if (vc == null || vc < 1) {
      errors.add("Version code must be a positive integer.")
    }
    val hexRegex = Regex("^#[0-9A-Fa-f]{6}$")
    if (!hexRegex.matches(statusBarHex.trim())) errors.add("Status bar color must be #RRGGBB.")
    if (!hexRegex.matches(navBarHex.trim())) errors.add("Navigation bar color must be #RRGGBB.")
    return ConfigValidationResult(isValid = errors.isEmpty(), errors = errors)
  }
}
