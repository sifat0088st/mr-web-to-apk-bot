package com.example

import com.example.data.ZipInspector
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ZipInspectorUnitTest {
  private fun createZip(entries: Map<String, ByteArray>): ByteArray {
    val baos = ByteArrayOutputStream()
    ZipOutputStream(baos).use { zos ->
      for ((name, bytes) in entries) {
        zos.putNextEntry(ZipEntry(name))
        zos.write(bytes)
        zos.closeEntry()
      }
    }
    return baos.toByteArray()
  }

  @Test
  fun validStaticZipWithHarmlessPhpSqlTextInJsPasses() {
    val zipBytes = createZip(
      mapOf(
        "index.html" to "<!doctype html><html><body>OK</body></html>".toByteArray(),
        "app.js" to "const msg = 'php and sql require external API';".toByteArray(),
        "config.json" to """{"note":"sql"}""".toByteArray(),
      )
    )
    val report = ZipInspector.scanZipStream(ByteArrayInputStream(zipBytes), "site.zip", zipBytes.size.toLong())
    assertTrue("Expected valid static ZIP to pass: ${report.findings}", report.passed)
  }

  @Test
  fun phpFileAndPathTraversalAreRejected() {
    val phpZip = createZip(
      mapOf(
        "index.html" to "<html></html>".toByteArray(),
        "shell.php" to "<?php echo 1; ?>".toByteArray(),
      )
    )
    val report = ZipInspector.scanZipStream(ByteArrayInputStream(phpZip), "bad.zip", phpZip.size.toLong())
    assertFalse(report.passed)

    val travZip = createZip(
      mapOf(
        "index.html" to "<html></html>".toByteArray(),
        "../escape.txt" to "hi".toByteArray(),
      )
    )
    val travReport = ZipInspector.scanZipStream(ByteArrayInputStream(travZip), "trav.zip", travZip.size.toLong())
    assertFalse(travReport.passed)
  }

  @Test
  fun appFormValidationChecksPackageAndVersionCode() {
    assertTrue(ZipInspector.validateAppForm("ShopApp", "com.mrwebtoapk.shop", "1", "#10B981", "#111827").isValid)
    assertFalse(ZipInspector.validateAppForm("ShopApp", "com.class.shop", "0", "#10B981", "#111827").isValid)
  }
}
