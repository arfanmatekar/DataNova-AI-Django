"""Authenticated DataNova workspace pages and JSON API endpoints."""

import json

from django.contrib import messages
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm
from django.core.exceptions import ValidationError
from django.db.models import Count
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_POST

from .analytics import answer_question, dataset_summary, parse_upload
from .forms import DataNovaSignupForm
from .models import DataNovaProject, LearningMilestone, ProjectDataset


DEFAULT_MILESTONES = (
    ('Create your first project', 'Give your analysis a place to live.'),
    ('Upload a dataset', 'Bring CSV, Excel, or JSON data into your workspace.'),
    ('Ask AI a question', 'Uncover a trend, total, or unusual value.'),
    ('Complete a learning milestone', 'Keep exploring and grow your score.'),
)


def _ensure_milestones(user):
    for position, (title, description) in enumerate(DEFAULT_MILESTONES):
        LearningMilestone.objects.get_or_create(
            user=user,
            title=title,
            defaults={'description': description, 'position': position},
        )


def _user_projects(user):
    return DataNovaProject.objects.filter(user=user).annotate(
        dataset_count=Count('dataset')
    )


def _serialize_project(project):
    has_dataset = hasattr(project, 'dataset')
    return {
        'id': project.pk,
        'name': project.name,
        'description': project.description,
        'status': project.status,
        'status_label': project.get_status_display(),
        'created_at': project.created_at.isoformat(),
        'updated_at': project.updated_at.isoformat(),
        'has_dataset': has_dataset,
        'row_count': len(project.dataset.rows) if has_dataset else 0,
        'column_count': len(project.dataset.columns) if has_dataset else 0,
        'filename': project.dataset.filename if has_dataset else None,
        'url': reverse('datanova:project-detail', args=[project.pk]),
    }


def _learning_data(user):
    milestones = list(LearningMilestone.objects.filter(user=user))
    total = len(milestones)
    completed = sum(milestone.completed for milestone in milestones)
    return {
        'milestones': [
            {
                'id': milestone.pk,
                'title': milestone.title,
                'description': milestone.description,
                'completed': milestone.completed,
            }
            for milestone in milestones
        ],
        'score': round(completed / total * 100) if total else 0,
        'completed': completed,
        'total': total,
    }


def sign_in(request):
    if request.user.is_authenticated:
        return redirect('admin:index' if request.user.is_superuser else 'datanova:dashboard')
    form = AuthenticationForm(request, data=request.POST or None)
    if request.method == 'POST' and form.is_valid():
        authenticated_user = form.get_user()
        login(request, authenticated_user)
        destination = request.POST.get('next', '')
        if authenticated_user.is_superuser:
            destination = reverse('admin:index')
        elif not url_has_allowed_host_and_scheme(destination, allowed_hosts={request.get_host()}):
            destination = reverse('datanova:dashboard')
        return redirect(destination)
    return render(
        request,
        'datanova/auth.html',
        {'form': form, 'mode': 'login', 'next': request.GET.get('next', '')},
    )


def sign_up(request):
    if request.user.is_authenticated:
        return redirect('datanova:dashboard')
    form = DataNovaSignupForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        login(request, user)
        _ensure_milestones(user)
        messages.success(request, 'Your workspace is ready. Let’s explore your data.')
        return redirect('datanova:dashboard')
    return render(
        request,
        'datanova/auth.html',
        {'form': form, 'mode': 'signup'},
    )


@require_POST
def sign_out(request):
    logout(request)
    return redirect('datanova:login')


@login_required
def dashboard(request):
    _ensure_milestones(request.user)
    projects = list(_user_projects(request.user))
    context = {
        'projects_payload': [_serialize_project(project) for project in projects],
        'learning_payload': _learning_data(request.user),
        'active_project': None,
        'dataset_payload': None,
        'summary_payload': None,
        'page_title': 'Your projects',
    }
    return render(request, 'datanova/dashboard.html', context)


@login_required
def project_detail(request, project_id):
    _ensure_milestones(request.user)
    project = get_object_or_404(DataNovaProject, pk=project_id, user=request.user)
    projects = list(_user_projects(request.user))
    dataset = ProjectDataset.objects.filter(project=project).first()
    rows = dataset.rows if dataset else []
    columns = dataset.columns if dataset else []
    context = {
        'projects_payload': [_serialize_project(item) for item in projects],
        'learning_payload': _learning_data(request.user),
        'active_project': project,
        'dataset_payload': (
            {
                'filename': dataset.filename,
                'columns': columns,
                'rows': rows,
                'uploaded_at': dataset.uploaded_at.isoformat(),
            }
            if dataset else None
        ),
        'summary_payload': dataset_summary(columns, rows) if dataset else None,
        'page_title': project.name,
    }
    return render(request, 'datanova/dashboard.html', context)


def _json_body(request):
    try:
        payload = json.loads(request.body or b'{}')
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError('Send a valid JSON request.') from exc
    if not isinstance(payload, dict):
        raise ValidationError('The request body must be a JSON object.')
    return payload


def _error_response(message, status=400):
    return JsonResponse({'error': str(message)}, status=status)


@login_required
@require_POST
def project_collection(request):
    try:
        payload = _json_body(request)
        name = payload.get('name', '')
        description = payload.get('description', '')
        status = payload.get('status', DataNovaProject.Status.PLANNING)
        if not isinstance(name, str) or not name.strip():
            raise ValidationError('Give your project a name.')
        if len(name.strip()) > 80:
            raise ValidationError('Project names must be 80 characters or fewer.')
        if not isinstance(description, str) or len(description) > 2000:
            raise ValidationError('Descriptions must be 2,000 characters or fewer.')
        valid_statuses = {value for value, _ in DataNovaProject.Status.choices}
        if not isinstance(status, str) or status not in valid_statuses:
            raise ValidationError('Choose Planning, Active, or Completed.')
        project = DataNovaProject.objects.create(
            user=request.user,
            name=name.strip(),
            description=description.strip(),
            status=status,
        )
        LearningMilestone.objects.filter(
            user=request.user, title='Create your first project'
        ).update(completed=True)
        return JsonResponse({
            'project': _serialize_project(project),
            'learning': _learning_data(request.user),
        }, status=201)
    except ValidationError as exc:
        return _error_response(exc.messages[0])


@login_required
@require_POST
def project_item(request, project_id):
    try:
        project = get_object_or_404(DataNovaProject, pk=project_id, user=request.user)
        payload = _json_body(request)
        if payload.get('action') == 'delete':
            project.delete()
            return JsonResponse({'deleted': True})
        valid_statuses = {value for value, _ in DataNovaProject.Status.choices}
        name = payload.get('name', project.name)
        description = payload.get('description', project.description)
        status = payload.get('status', project.status)
        if not isinstance(name, str) or not name.strip():
            raise ValidationError('Give your project a name.')
        if len(name.strip()) > 80:
            raise ValidationError('Project names must be 80 characters or fewer.')
        if not isinstance(description, str) or len(description) > 2000:
            raise ValidationError('Descriptions must be 2,000 characters or fewer.')
        if not isinstance(status, str) or status not in valid_statuses:
            raise ValidationError('Choose Planning, Active, or Completed.')
        project.name = name.strip()
        project.description = description.strip()
        project.status = status
        project.save(update_fields=['name', 'description', 'status', 'updated_at'])
        return JsonResponse({'project': _serialize_project(project)})
    except ValidationError as exc:
        return _error_response(exc.messages[0])


@login_required
@require_POST
def dataset_upload(request, project_id):
    project = get_object_or_404(DataNovaProject, pk=project_id, user=request.user)
    upload = request.FILES.get('file')
    if upload is None:
        return _error_response('Choose a CSV, Excel, or JSON file to upload.')
    try:
        dataset_data = parse_upload(upload)
    except ValidationError as exc:
        return _error_response(exc.messages[0])
    dataset, _ = ProjectDataset.objects.update_or_create(
        project=project,
        defaults=dataset_data,
    )
    LearningMilestone.objects.filter(
        user=request.user, title='Upload a dataset'
    ).update(completed=True)
    return JsonResponse({
        'dataset': {
            'filename': dataset.filename,
            'columns': dataset.columns,
            'rows': dataset.rows,
            'uploaded_at': dataset.uploaded_at.isoformat(),
        },
        'summary': dataset_summary(dataset.columns, dataset.rows),
        'learning': _learning_data(request.user),
    }, status=201)


@login_required
@require_POST
def dataset_question(request, project_id):
    project = get_object_or_404(DataNovaProject, pk=project_id, user=request.user)
    try:
        payload = _json_body(request)
        dataset = ProjectDataset.objects.get(project=project)
        answer = answer_question(
            payload.get('question', ''),
            dataset.columns,
            dataset.rows,
        )
    except ProjectDataset.DoesNotExist:
        return _error_response('Upload a dataset before asking a question.', 404)
    except ValidationError as exc:
        return _error_response(exc.messages[0])
    LearningMilestone.objects.filter(
        user=request.user, title='Ask AI a question'
    ).update(completed=True)
    return JsonResponse({
        'answer': answer,
        'summary': dataset_summary(dataset.columns, dataset.rows),
        'learning': _learning_data(request.user),
    })


@login_required
@require_POST
def milestone_update(request, milestone_id):
    try:
        payload = _json_body(request)
        completed = payload.get('completed')
        if not isinstance(completed, bool):
            raise ValidationError('Milestone completion must be true or false.')
        milestone = get_object_or_404(
            LearningMilestone, pk=milestone_id, user=request.user
        )
        milestone.completed = completed
        milestone.save(update_fields=['completed'])
        return JsonResponse({'learning': _learning_data(request.user)})
    except ValidationError as exc:
        return _error_response(exc.messages[0])
