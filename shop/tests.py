import json
from io import BytesIO
from unittest import skipUnless

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse

from .analytics import answer_question, dataset_summary, parse_upload
from .models import DataNovaProject, LearningMilestone, ProjectDataset

try:
    import openpyxl
except ImportError:
    openpyxl = None


class DatasetParsingTests(TestCase):
    def test_csv_parsing_normalizes_headers_and_preserves_rows(self):
        upload = SimpleUploadedFile(
            'sales.csv',
            b'Product, Product ,Revenue\r\nWidget,Blue,100\r\nGadget,Green,50\r\n',
        )

        parsed = parse_upload(upload)

        self.assertEqual(parsed['filename'], 'sales.csv')
        self.assertEqual(parsed['columns'], ['Product', 'Product (2)', 'Revenue'])
        self.assertEqual(parsed['rows'][0]['Revenue'], '100')
        self.assertEqual(len(parsed['rows']), 2)

    def test_json_parsing_supports_wrapped_rows_and_union_of_columns(self):
        upload = SimpleUploadedFile(
            'sales.json',
            b'{"rows":[{"region":"West","sales":25},{"region":"East","returns":2}]}',
        )

        parsed = parse_upload(upload)

        self.assertEqual(parsed['columns'], ['region', 'sales', 'returns'])
        self.assertEqual(parsed['rows'][1], {'region': 'East', 'sales': None, 'returns': 2})

    def test_rejects_unsupported_extension_and_invalid_csv_encoding(self):
        with self.assertRaisesMessage(ValidationError, 'Upload a .csv, .xlsx, or .json'):
            parse_upload(SimpleUploadedFile('report.txt', b'a\n1'))
        with self.assertRaisesMessage(ValidationError, 'CSV files must use UTF-8'):
            parse_upload(SimpleUploadedFile('report.csv', b'\xff'))

    def test_rejects_empty_dataset_and_too_many_columns(self):
        with self.assertRaisesMessage(ValidationError, 'at least one data row'):
            parse_upload(SimpleUploadedFile('empty.csv', b'name,value\n'))
        too_many_columns = ','.join(f'field-{i}' for i in range(101)).encode()
        with self.assertRaisesMessage(ValidationError, 'at most 100 columns'):
            parse_upload(SimpleUploadedFile('wide.csv', too_many_columns + b'\n1\n'))

    @skipUnless(openpyxl, 'Install requirements.txt to test Excel uploads.')
    def test_xlsx_parsing_reads_the_active_sheet(self):
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.append(['Date', 'Revenue'])
        sheet.append(['Monday', 42])
        content = BytesIO()
        workbook.save(content)

        parsed = parse_upload(
            SimpleUploadedFile('sales.xlsx', content.getvalue())
        )

        self.assertEqual(parsed['columns'], ['Date', 'Revenue'])
        self.assertEqual(parsed['rows'][0]['Revenue'], 42)

    def test_summary_and_natural_language_questions_use_real_dataset_values(self):
        columns = ['day', 'sales']
        rows = [
            {'day': 'Mon', 'sales': '10'},
            {'day': 'Tue', 'sales': '20'},
            {'day': 'Wed', 'sales': '70'},
        ]

        self.assertEqual(dataset_summary(columns, rows)['numeric']['sales']['sum'], 100.0)
        self.assertIn('total for "sales" is 100', answer_question('Calculate total sales', columns, rows))
        self.assertIn('upward trend', answer_question('Show trends', columns, rows))
        with self.assertRaisesMessage(ValidationError, 'Type a question'):
            answer_question(None, columns, rows)


class DataNovaWorkspaceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='analyst',
            email='analyst@example.test',
            password='DataNova-Password-481!',
        )
        self.client.force_login(self.user)
        self.client.get(reverse('datanova:dashboard'))

    def create_project(self, name='Sales insights', **kwargs):
        return DataNovaProject.objects.create(user=self.user, name=name, **kwargs)

    def test_anonymous_dashboard_redirects_to_sign_in(self):
        self.client.logout()

        response = self.client.get(reverse('datanova:dashboard'))

        self.assertRedirects(
            response,
            f'{reverse("datanova:login")}?next={reverse("datanova:dashboard")}',
        )

    def test_signup_creates_an_account_logs_in_and_redirects_to_workspace(self):
        self.client.logout()

        response = self.client.post(reverse('datanova:signup'), {
            'username': 'new-analyst',
            'email': 'new-analyst@example.test',
            'password1': 'Another-Strong-Password-829!',
            'password2': 'Another-Strong-Password-829!',
        })

        self.assertRedirects(response, reverse('datanova:dashboard'))
        self.assertTrue(User.objects.filter(username='new-analyst').exists())
        self.assertEqual(
            LearningMilestone.objects.filter(user__username='new-analyst').count(),
            4,
        )

    def test_sign_in_redirects_analysts_to_the_workspace(self):
        self.client.logout()

        response = self.client.post(reverse('datanova:login'), {
            'username': self.user.username,
            'password': 'DataNova-Password-481!',
        })

        self.assertRedirects(response, reverse('datanova:dashboard'))

    def test_sign_in_redirects_administrators_to_django_admin(self):
        administrator = User.objects.create_superuser(
            username='workspace-admin',
            email='workspace-admin@example.test',
            password='Administrator-Strong-481!',
        )
        self.client.logout()

        response = self.client.post(reverse('datanova:login'), {
            'username': administrator.username,
            'password': 'Administrator-Strong-481!',
        })

        self.assertRedirects(response, reverse('admin:index'))

    def test_create_filter_update_and_delete_projects(self):
        response = self.client.post(
            reverse('datanova:project-collection'),
            data=json.dumps({
                'name': '  Q3 sales  ',
                'description': 'Quarterly sales trends.',
                'status': 'active',
            }),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 201)
        project_id = response.json()['project']['id']
        self.assertEqual(response.json()['project']['name'], 'Q3 sales')
        self.assertEqual(response.json()['learning']['score'], 25)
        project = DataNovaProject.objects.get(pk=project_id, user=self.user)

        response = self.client.post(
            reverse('datanova:project-item', args=[project.pk]),
            data=json.dumps({'name': 'Q3 sales final', 'status': 'completed'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['project']['status'], 'completed')

        response = self.client.post(
            reverse('datanova:project-item', args=[project.pk]),
            data=json.dumps({'action': 'delete'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(DataNovaProject.objects.filter(pk=project.pk).exists())

    def test_project_api_rejects_invalid_fields(self):
        response = self.client.post(
            reverse('datanova:project-collection'),
            data=json.dumps({'name': 'Invalid', 'status': []}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('Planning, Active, or Completed', response.json()['error'])

    def test_upload_question_and_milestones_are_persistent(self):
        project = self.create_project()
        LearningMilestone.objects.filter(
            user=self.user,
            title='Create your first project',
        ).update(completed=True)
        upload_response = self.client.post(
            reverse('datanova:dataset-upload', args=[project.pk]),
            {'file': SimpleUploadedFile(
                'sales.csv',
                b'day,sales\nMon,10\nTue,20\nWed,70\n',
                content_type='text/csv',
            )},
        )

        self.assertEqual(upload_response.status_code, 201)
        self.assertEqual(upload_response.json()['summary']['numeric']['sales']['sum'], 100.0)
        self.assertTrue(ProjectDataset.objects.filter(project=project).exists())
        self.assertEqual(upload_response.json()['learning']['score'], 50)

        question_response = self.client.post(
            reverse('datanova:dataset-question', args=[project.pk]),
            data=json.dumps({'question': 'Calculate total sales'}),
            content_type='application/json',
        )

        self.assertEqual(question_response.status_code, 200)
        self.assertIn('100', question_response.json()['answer'])
        self.assertEqual(question_response.json()['learning']['score'], 75)

    def test_user_cannot_read_or_update_another_users_project(self):
        other_user = User.objects.create_user(
            username='other-analyst',
            password='Other-Strong-Password-739!',
        )
        project = DataNovaProject.objects.create(user=other_user, name='Private analysis')

        self.assertEqual(
            self.client.get(reverse('datanova:project-detail', args=[project.pk])).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                reverse('datanova:project-item', args=[project.pk]),
                data=json.dumps({'name': 'Stolen'}),
                content_type='application/json',
            ).status_code,
            404,
        )
        project.refresh_from_db()
        self.assertEqual(project.name, 'Private analysis')

    def test_milestone_toggle_updates_the_learning_score(self):
        milestone = LearningMilestone.objects.filter(user=self.user).first()

        response = self.client.post(
            reverse('datanova:milestone-update', args=[milestone.pk]),
            data=json.dumps({'completed': True}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['learning']['score'], 25)

    def test_dashboard_contains_local_interactive_analytics(self):
        project = self.create_project()
        ProjectDataset.objects.create(
            project=project,
            filename='sales.csv',
            columns=['date', 'sales'],
            rows=[{'date': 'Monday', 'sales': '10'}],
        )

        response = self.client.get(reverse('datanova:project-detail', args=[project.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Ask your data')
        self.assertContains(response, 'Generate report')
        self.assertContains(response, 'sales.csv')
