import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { connect } from "framer-api"

const requiredVariables = [
  "FRAMER_PROJECT_URL",
  "FRAMER_API_KEY",
  "FRAMER_COLLECTION_ID",
  "FRAMER_SOURCE_FILENAME_FIELD_ID",
  "FRAMER_LAST_UPDATED_FIELD_ID",
  "BEFORE_SHA",
  "AFTER_SHA",
]

const publishFramer =
  String(process.env.PUBLISH_FRAMER).toLowerCase() === "true"

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`Missing required environment variable: ${variable}`)
  }
}

const {
  FRAMER_PROJECT_URL: projectUrl,
  FRAMER_API_KEY: apiKey,
  FRAMER_COLLECTION_ID: collectionId,
  FRAMER_SOURCE_FILENAME_FIELD_ID: sourceFilenameFieldId,
  FRAMER_LAST_UPDATED_FIELD_ID: lastUpdatedFieldId,
  BEFORE_SHA: beforeSha,
  AFTER_SHA: afterSha,
} = process.env

function readFieldValue(fieldData) {
  if (
    fieldData &&
    typeof fieldData === "object" &&
    "value" in fieldData
  ) {
    return fieldData.value
  }

  return fieldData
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase()
}

const zeroSha = /^0+$/.test(beforeSha)

const changedOutput = zeroSha
  ? execFileSync(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", afterSha],
      { encoding: "utf8" }
    )
  : execFileSync(
      "git",
      ["diff", "--name-only", beforeSha, afterSha, "--", "pdfs"],
      { encoding: "utf8" }
    )

const changedPdfs = [
  ...new Set(
    changedOutput
      .split(/\r?\n/)
      .map(file => file.trim())
      .filter(file => file.toLowerCase().endsWith(".pdf"))
      .filter(file => file.startsWith("pdfs/"))
      .filter(file => existsSync(file))
  ),
]

if (changedPdfs.length === 0) {
  console.log("No existing PDF files require a CMS date update.")
  process.exit(0)
}

console.log(`Changed PDFs: ${changedPdfs.length}`)

for (const file of changedPdfs) {
  console.log(`- ${file}`)
}

const framer = await connect(projectUrl, apiKey)

try {
  const collection = await framer.getCollection(collectionId)

  if (!collection) {
    throw new Error(`Framer collection not found: ${collectionId}`)
  }

  const items = await collection.getItems()
  const cmsItemsByFilename = new Map()

  for (const item of items) {
    const sourceFilename = readFieldValue(
      item.fieldData?.[sourceFilenameFieldId]
    )

    if (sourceFilename) {
      cmsItemsByFilename.set(normalize(sourceFilename), item)
    }
  }

  let updatedCount = 0
  let skippedCount = 0

  for (const file of changedPdfs) {
    const basename = path.basename(file)
    const item = cmsItemsByFilename.get(normalize(basename))

    if (!item) {
      console.log(
        `SKIPPED: ${file} has no matching Framer CMS record.`
      )
      skippedCount += 1
      continue
    }

    const gitDate = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--", file],
      { encoding: "utf8" }
    ).trim()

    if (!gitDate) {
      throw new Error(`No Git history found for: ${file}`)
    }

    const isoDate = new Date(gitDate).toISOString()

    await item.setAttributes({
      fieldData: {
        [lastUpdatedFieldId]: {
          type: "date",
          value: isoDate,
        },
      },
    })

    console.log(`UPDATED: ${basename} → ${isoDate}`)
    updatedCount += 1
  }

  console.log(`Updated CMS records: ${updatedCount}`)
  console.log(`Skipped repository PDFs: ${skippedCount}`)

  if (updatedCount > 0 && publishFramer) {
    console.log("Publishing the updated Framer project...")

    const publication = await framer.publish()
    const deploymentId = publication.deployment.id

    console.log(`Created Framer deployment: ${deploymentId}`)
    console.log("Promoting the deployment to production...")

    await framer.deploy(deploymentId)

    console.log("Framer was published to production successfully.")
  } else if (updatedCount > 0) {
    console.log("Framer publishing is disabled for this run.")
  } else {
    console.log("Nothing was published because no CMS records changed.")
  }


} finally {
  await framer.disconnect()
}
