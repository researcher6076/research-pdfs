import { execFileSync } from "node:child_process"
import { connect } from "framer-api"

const requiredVariables = [
  "FRAMER_PROJECT_URL",
  "FRAMER_API_KEY",
  "FRAMER_COLLECTION_ID",
  "FRAMER_SOURCE_FILENAME_FIELD_ID",
  "FRAMER_LAST_UPDATED_FIELD_ID",
  "SOURCE_FILENAME",
  "PAPER_PATH",
]

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
  SOURCE_FILENAME: requestedSourceFilename,
  PAPER_PATH: paperPath,
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

// Read the date of the most recent commit that changed this specific file.
const gitDate = execFileSync(
  "git",
  ["log", "-1", "--format=%cI", "--", paperPath],
  { encoding: "utf8" }
).trim()

if (!gitDate) {
  throw new Error(`No Git history was found for: ${paperPath}`)
}

const revisionDate = new Date(gitDate)

if (Number.isNaN(revisionDate.getTime())) {
  throw new Error(`Git returned an invalid date: ${gitDate}`)
}

const framer = await connect(projectUrl, apiKey)

try {
  const collection = await framer.getCollection(collectionId)

  if (!collection) {
    throw new Error(`Framer collection not found: ${collectionId}`)
  }

  const fields = await collection.getFields()

  const sourceField = fields.find(
    field => field.id === sourceFilenameFieldId
  )

  const lastUpdatedField = fields.find(
    field => field.id === lastUpdatedFieldId
  )

  if (!sourceField) {
    throw new Error("The Source Filename field was not found.")
  }

  if (!lastUpdatedField) {
    throw new Error("The Last Updated field was not found.")
  }

  if (lastUpdatedField.type !== "date") {
    throw new Error(
      `Last Updated must be a date field, not ${lastUpdatedField.type}.`
    )
  }

  const items = await collection.getItems()

  const item = items.find(candidate => {
    const value = readFieldValue(
      candidate.fieldData?.[sourceFilenameFieldId]
    )

    return normalize(value) === normalize(requestedSourceFilename)
  })

  if (!item) {
    const knownFilenames = items
      .map(candidate =>
        readFieldValue(candidate.fieldData?.[sourceFilenameFieldId])
      )
      .filter(Boolean)
      .join(", ")

    throw new Error(
      `No CMS item has Source Filename "${requestedSourceFilename}". ` +
      `Known values: ${knownFilenames}`
    )
  }

  const isoDate = revisionDate.toISOString()

  await item.setAttributes({
    fieldData: {
      [lastUpdatedFieldId]: {
        type: "date",
        value: isoDate,
      },
    },
  })

  console.log(`Updated: ${item.slug}`)
  console.log(`Source Filename: ${requestedSourceFilename}`)
  console.log(`Git file: ${paperPath}`)
  console.log(`Last Updated: ${isoDate}`)
  console.log("The Framer project was not published.")
} finally {
  await framer.disconnect()
}
