# 🌿 TribalScholar 
### AI-Enabled Scholarship & Fellowship Management System for Scheduled Tribe Students

<p align="center">
  <strong>SIH 2026 | Problem Statement PS239</strong>
</p>

<p align="center">
  A student-focused digital platform designed to simplify scholarship
  applications, improve application readiness, and make application
  tracking more transparent for Scheduled Tribe students.
</p>

---

## 📌 About the Project

**TribalScholar 360** is a web-based prototype developed in response to
Smart India Hackathon (SIH) 2026 Problem Statement **PS239**.

The project focuses on simplifying the scholarship and fellowship
application journey for Scheduled Tribe (ST) students.

Students often need to understand scheme requirements, prepare multiple
documents, complete application forms, and follow up on their application
status. TribalScholar brings these activities together through a unified
and easy-to-use interface.

The platform demonstrates a student application portal, an application
readiness checker, application tracking, and an officer dashboard.

Our vision is to make scholarship management more accessible,
transparent, and student-friendly.

---

## 🎯 Problem Statement — PS239

**AI-Enabled Scholarship and Fellowship Management System for Scheduled
Tribes**

The proposed system aims to streamline the scholarship and fellowship
management process for ST students by bringing application assistance,
document-related checks, application tracking, and officer review into
one platform.

TribalScholar explores how a digital system can help reduce confusion
during application submission and make the application workflow easier
to understand for both students and reviewing officers.

---

## 💡 Our Solution

TribalScholar provides a unified interface with two primary user
perspectives:

### 👨‍🎓 Student Portal

Students can:

- Explore the available scholarship schemes.
- Select a scheme and fill out an application.
- Enter personal, academic, and family-income details.
- Attach the required documents through the application form.
- Check whether required information and documents are present.
- Receive a generated application ID.
- Track the application status.

### 🧑‍💼 Officer Portal

The demonstration officer dashboard allows users to:

- View submitted demo applications.
- View application details.
- Check a basic document-completeness summary.
- Update an application's workflow status.
- View application statistics.

---

## ✨ Key Features

### 1. 🏠 Student-Friendly Home Page

- Clean and accessible interface.
- Overview of the platform.
- Scholarship scheme cards.
- Application statistics.
- Step-by-step explanation of the application process.

### 2. 🎓 Scholarship Scheme Selection

The prototype presents two scholarship and fellowship schemes:

- **NFST** — National Fellowship for ST Students
- **NOS** — National Overseas Scholarship

Students can select a scheme directly from the home page or the
application form.

> Scheme information in this prototype is for demonstration purposes.
> Students should refer to official government sources for current
> eligibility conditions and application guidelines.

### 3. 📝 Scholarship Application Form

The application form collects:

- Full name
- Email address
- Mobile number
- Selected scheme
- Education level
- Annual family income
- Marks or percentage
- Institution or university
- Required document selections

Basic form validation helps prevent incomplete or invalid submissions.

### 4. ✅ Application Readiness Checker

The readiness checker performs basic checks before submission.

It identifies:

- Missing application fields.
- Missing required document selections.
- Invalid mobile number format.
- Invalid income values.
- Marks outside the accepted 0–100 range.

The checker helps students identify common omissions before submitting
their application.

**Note:** This is a rule-based demonstration. It does not establish
official eligibility or verify the authenticity of documents.

### 5. 🆔 Application ID Generation

After a successful submission, the system generates a unique-looking
demo application ID.

Example:

`TS260001`

The generated ID can be used to find the corresponding application
through the tracking page.

### 6. 📊 Application Tracking

Students can enter their application ID to view:

- Student and scheme details.
- Submission date.
- Current application status.
- Officer review note, when available.
- Application progress timeline.

The prototype demonstrates these workflow statuses:

- Submitted
- Under Review
- Deficient
- Approved
- Rejected

These statuses represent the application's state in the demo and are
not official scholarship decisions.

### 7. 🧑‍💼 Officer Dashboard

The officer dashboard provides:

- Total application count.
- Applications under review.
- Deficient applications.
- Applications marked approved in the demo.
- Submitted application records.
- Application detail viewing.
- Status update controls.

This demonstrates how a centralized dashboard could support application
review and workflow management.

### 8. 🌐 Language Translation Support

The interface includes Google Translate integration to help users
explore the portal in supported languages.

Translation quality and language availability depend on the
translation service.

### 9. 📱 Responsive Interface

The interface uses HTML and CSS to provide a structured layout for
the home page, application form, tracking page, and officer dashboard.

---

## 🔄 How It Works

```text
        Student Visits TribalScholar
                    |
                    v
         Explore Scholarship Schemes
                    |
                    v
          Select Scheme and Apply
                    |
                    v
        Enter Details and Select Files
                    |
                    v
       Run Application Readiness Check
                    |
                    v
         Submit the Application
                    |
                    v
          Generate Application ID
                    |
                    v
          Track Application Status
                    |
                    v
         Officer Updates Demo Status
                    |
                    v
       Student Views Updated Status
